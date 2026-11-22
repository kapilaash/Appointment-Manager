"""Change password, forgot password (every role) and two-step sign-in, through the real HTTP API.

Needs TEST_DATABASE_URL (PostgreSQL) and a reachable Redis (TEST_REDIS_URL, default db 15).
"""

import re
from collections.abc import AsyncIterator
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pyotp
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.auth import mfa, session_store
from app.auth import routes as auth_routes
from app.auth.models import AccountToken
from app.core.security import hash_password
from app.db.session import get_db_session
from app.main import app
from app.scheduling.models import OutboxEvent
from app.users.models import User, UserRole

PASSWORD = "Knight moves in an L shape"
NEW_PASSWORD = "Castle early and often 2026"


@pytest.fixture
async def redis_ready() -> AsyncIterator[None]:
    # The cached client belongs to the previous test's event loop; start fresh each time.
    session_store._redis_client = None
    redis = session_store.get_redis_client()
    try:
        await redis.ping()
    except Exception:  # noqa: BLE001 - any connection problem means "no Redis here"
        pytest.skip("Redis is not reachable (set TEST_REDIS_URL)")
    await redis.flushdb()  # dedicated test database only (see conftest.py)
    yield
    await session_store.close_redis_client()


@pytest.fixture
async def account(
    sessions: async_sessionmaker[AsyncSession], redis_ready: None
) -> AsyncIterator[SimpleNamespace]:
    async with sessions() as db:
        user = User(
            email=f"admin-{uuid4().hex[:8]}@example.com",
            password_hash=hash_password(PASSWORD),
            role=UserRole.ADMIN,
            full_name="Security Admin",
        )
        db.add(user)
        await db.commit()

    async def override_session() -> AsyncIterator[AsyncSession]:
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_db_session] = override_session
    yield SimpleNamespace(user=user, sessions=sessions)
    app.dependency_overrides.clear()


def new_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


async def sign_in(client: httpx.AsyncClient, email: str, password: str) -> httpx.Response:
    response = await client.post("/api/v1/auth/login", json={"email": email, "password": password})
    if "csrf_token" in client.cookies:
        client.headers["X-CSRF-Token"] = client.cookies["csrf_token"]
    return response


async def outbox_types(account: SimpleNamespace) -> list[str]:
    async with account.sessions() as db:
        return list(
            (
                await db.scalars(
                    select(OutboxEvent.event_type).where(
                        OutboxEvent.aggregate_id == account.user.id
                    )
                )
            ).all()
        )


async def test_change_password_keeps_this_device_and_signs_out_others(account) -> None:
    email = account.user.email
    async with new_client() as laptop, new_client() as phone:
        assert (await sign_in(laptop, email, PASSWORD)).status_code == 200
        assert (await sign_in(phone, email, PASSWORD)).status_code == 200

        wrong = await laptop.post(
            "/api/v1/auth/me/password",
            json={"current_password": "not it at all", "new_password": NEW_PASSWORD},
        )
        assert wrong.status_code == 400
        weak = await laptop.post(
            "/api/v1/auth/me/password",
            json={"current_password": PASSWORD, "new_password": "password1234"},
        )
        assert weak.status_code == 422
        same = await laptop.post(
            "/api/v1/auth/me/password",
            json={"current_password": PASSWORD, "new_password": PASSWORD},
        )
        assert same.status_code == 422

        changed = await laptop.post(
            "/api/v1/auth/me/password",
            json={"current_password": PASSWORD, "new_password": NEW_PASSWORD},
        )
        assert changed.status_code == 204, changed.text
        assert (
            await laptop.get("/api/v1/auth/me")
        ).status_code == 200  # this device stays signed in
        assert (
            await phone.get("/api/v1/auth/me")
        ).status_code == 401  # other devices are signed out

    async with new_client() as client:
        assert (await sign_in(client, email, PASSWORD)).status_code == 401
        assert (await sign_in(client, email, NEW_PASSWORD)).status_code == 200
    assert "account.password_changed" in await outbox_types(account)


async def test_admins_can_reset_a_forgotten_password_by_email(account, monkeypatch) -> None:
    sent: list[tuple[str, str]] = []

    async def capture(message) -> None:
        sent.append((message["To"], message.get_content()))

    monkeypatch.setattr(auth_routes, "send_message", capture)
    async with new_client() as client:
        unknown = await client.post(
            "/api/v1/auth/password-reset-request", json={"email": "nobody@example.com"}
        )
        known = await client.post(
            "/api/v1/auth/password-reset-request", json={"email": account.user.email}
        )
        # Same answer either way, so the form cannot be used to discover accounts.
        assert unknown.json() == known.json()
        assert [to for to, _ in sent] == [account.user.email]
        token = re.search(r"/reset-password#token=([\w-]+)", sent[0][1]).group(1)

        weak = await client.post(
            "/api/v1/auth/password-reset", json={"token": token, "password": "qwertyuiop12"}
        )
        assert weak.status_code == 422
        reset = await client.post(
            "/api/v1/auth/password-reset", json={"token": token, "password": NEW_PASSWORD}
        )
        assert reset.status_code == 204, reset.text
        reused = await client.post(
            "/api/v1/auth/password-reset",
            json={"token": token, "password": "Another long passphrase"},
        )
        assert reused.status_code == 400
        assert (await sign_in(client, account.user.email, NEW_PASSWORD)).status_code == 200

    async with account.sessions() as db:
        purposes = (
            await db.scalars(
                select(AccountToken.purpose).where(AccountToken.user_id == account.user.id)
            )
        ).all()
    assert purposes == ["password_reset"]


async def test_two_step_sign_in_with_authenticator_and_recovery_codes(account) -> None:
    email = account.user.email
    async with new_client() as client:
        await sign_in(client, email, PASSWORD)
        setup = (await client.post("/api/v1/auth/me/mfa/setup")).json()
        assert setup["otpauth_uri"].startswith("otpauth://totp/")
        assert (
            await client.post("/api/v1/auth/me/mfa/enable", json={"code": "000000"})
        ).status_code == 400
        enabled = await client.post(
            "/api/v1/auth/me/mfa/enable", json={"code": pyotp.TOTP(setup["secret"]).now()}
        )
        assert enabled.status_code == 200
        recovery_codes = enabled.json()["recovery_codes"]
        assert len(recovery_codes) == 10
        assert (await client.get("/api/v1/auth/me")).json()["mfa_enabled"] is True

    async with account.sessions() as db:
        stored = await db.get(User, account.user.id)
        assert setup["secret"] not in (stored.mfa_secret_encrypted or "")  # encrypted at rest
        assert mfa.decrypt_secret(stored.mfa_secret_encrypted) == setup["secret"]

    totp = pyotp.TOTP(setup["secret"])
    async with new_client() as client:
        first = (await sign_in(client, email, PASSWORD)).json()
        assert first == {"mfa_required": True, "mfa_token": first["mfa_token"]}
        assert (
            await client.get("/api/v1/auth/me")
        ).status_code == 401  # no session after the password alone
        assert (
            await client.post(
                "/api/v1/auth/login/mfa", json={"mfa_token": first["mfa_token"], "code": "123456"}
            )
        ).status_code == 400
        code = totp.now()
        ok = await client.post(
            "/api/v1/auth/login/mfa", json={"mfa_token": first["mfa_token"], "code": code}
        )
        assert ok.status_code == 200 and ok.json()["email"] == email
        assert (await client.get("/api/v1/auth/me")).status_code == 200

    async with new_client() as client:
        second = (await sign_in(client, email, PASSWORD)).json()
        # The same code cannot be replayed on another attempt.
        assert (
            await client.post(
                "/api/v1/auth/login/mfa", json={"mfa_token": second["mfa_token"], "code": code}
            )
        ).status_code == 400
        # A recovery code works once, in any letter case or spacing.
        recovery = recovery_codes[0].upper().replace("-", " ")
        assert (
            await client.post(
                "/api/v1/auth/login/mfa", json={"mfa_token": second["mfa_token"], "code": recovery}
            )
        ).status_code == 200

    async with new_client() as client:
        third = (await sign_in(client, email, PASSWORD)).json()
        assert (
            await client.post(
                "/api/v1/auth/login/mfa",
                json={"mfa_token": third["mfa_token"], "code": recovery_codes[0]},
            )
        ).status_code == 400
        for _ in range(3):
            await client.post(
                "/api/v1/auth/login/mfa", json={"mfa_token": third["mfa_token"], "code": "654321"}
            )
        locked = await client.post(
            "/api/v1/auth/login/mfa", json={"mfa_token": third["mfa_token"], "code": "654321"}
        )
        assert locked.status_code == 429  # five wrong codes end the attempt
        assert (
            await client.post(
                "/api/v1/auth/login/mfa", json={"mfa_token": third["mfa_token"], "code": totp.now()}
            )
        ).status_code == 401

    async with new_client() as client:
        fourth = (await sign_in(client, email, PASSWORD)).json()
        await client.post(
            "/api/v1/auth/login/mfa",
            json={"mfa_token": fourth["mfa_token"], "code": recovery_codes[1]},
        )
        client.headers["X-CSRF-Token"] = client.cookies["csrf_token"]
        assert (
            await client.post(
                "/api/v1/auth/me/mfa/disable",
                json={"password": "wrong password!", "code": recovery_codes[2]},
            )
        ).status_code == 400
        assert (
            await client.post(
                "/api/v1/auth/me/mfa/disable",
                json={"password": PASSWORD, "code": recovery_codes[2]},
            )
        ).status_code == 204
        assert (await client.get("/api/v1/auth/me")).json()["mfa_enabled"] is False

    assert {"account.mfa_enabled", "account.mfa_disabled"} <= set(await outbox_types(account))


def test_password_policy_blocks_common_and_personal_passwords() -> None:
    from app.auth.passwords import password_problem

    assert password_problem("short") is not None
    assert password_problem("ChessAcademy123") is not None  # on the leaked/common list
    assert password_problem("aaaaaaaaaaaaab") is not None  # too repetitive
    assert password_problem("priya.sharma.2026!", email="priya.sharma@example.com") is not None
    assert password_problem("Correct horse battery staple") is None


async def test_security_notice_email_reaches_the_account_owner(account, monkeypatch) -> None:
    from app.workers import main as worker

    sent: list[tuple[str, str, str]] = []

    async def capture(message) -> None:
        sent.append((message["To"], message["Subject"], message.get_content()))

    monkeypatch.setattr(worker, "send_message", capture)
    async with new_client() as client:
        await sign_in(client, account.user.email, PASSWORD)
        await client.post(
            "/api/v1/auth/me/password",
            json={"current_password": PASSWORD, "new_password": NEW_PASSWORD},
        )

    async with account.sessions() as db:
        event = await db.scalar(
            select(OutboxEvent).where(OutboxEvent.aggregate_id == account.user.id)
        )
        await worker._deliver_account_event(
            db, event_key=str(event.id), event_type=event.event_type, user_id=event.aggregate_id
        )
    assert len(sent) == 1
    to, subject, body = sent[0]
    assert to == account.user.email
    assert subject == "Your Thirumal Chess Academy password was changed"
    assert "/forgot-password" in body  # a way back if it was not them
