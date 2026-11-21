from __future__ import annotations

import threading
from types import SimpleNamespace
from typing import Any
from uuid import uuid4

import pytest
from fastapi import HTTPException, Request, Response

from app.auth import routes as auth_routes
from app.auth.rate_limit import (
    LOGIN_EMAIL_FAILURE_LIMIT,
    LOGIN_FAILURE_WINDOW_SECONDS,
    LOGIN_IP_FAILURE_LIMIT,
    clear_login_failures,
    get_login_failure_state,
    record_login_failure,
)
from app.auth.schemas import LoginRequest
from app.auth.session_store import SessionStore
from app.users.models import UserRole


class FakePipeline:
    def __init__(self, redis: FakeRedis) -> None:
        self.redis = redis
        self.operations: list[tuple[Any, ...]] = []

    def get(self, key: str) -> None:
        self.operations.append(("get", key))

    def ttl(self, key: str) -> None:
        self.operations.append(("ttl", key))

    def incr(self, key: str) -> None:
        self.operations.append(("incr", key))

    def expire(self, key: str, seconds: int, nx: bool = False) -> None:
        self.operations.append(("expire", key, seconds, nx))

    async def execute(self) -> list[Any]:
        results = []
        for operation in self.operations:
            name, key, *args = operation
            if name == "get":
                results.append(self.redis.values.get(key))
            elif name == "ttl":
                results.append(self.redis.ttls.get(key, -2))
            elif name == "incr":
                value = int(self.redis.values.get(key, 0)) + 1
                self.redis.values[key] = value
                results.append(value)
            elif name == "expire":
                _seconds, nx = args
                if not nx or key not in self.redis.ttls:
                    self.redis.ttls[key] = args[0]
                results.append(True)
        return results


class FakeRedis:
    def __init__(self) -> None:
        self.values: dict[str, int] = {}
        self.ttls: dict[str, int] = {}

    def pipeline(self, transaction: bool = True) -> FakePipeline:
        assert transaction
        return FakePipeline(self)

    async def delete(self, *keys: str) -> None:
        for key in keys:
            self.values.pop(key, None)
            self.ttls.pop(key, None)


class FakeResult:
    def __init__(self, value: Any = None) -> None:
        self.value = value

    def scalar_one_or_none(self) -> Any:
        return self.value


class FakeDatabase:
    def __init__(self, user: Any = None) -> None:
        self.user = user

    async def execute(self, _statement: Any) -> FakeResult:
        return FakeResult(self.user)


def request_from(ip: str) -> Request:
    return Request({
        "type": "http",
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": "/api/v1/auth/login",
        "raw_path": b"/api/v1/auth/login",
        "query_string": b"",
        "headers": [],
        "client": (ip, 12345),
        "server": ("testserver", 80),
    })


@pytest.mark.asyncio
async def test_login_failures_are_hashed_and_expire_after_a_fixed_window() -> None:
    redis = FakeRedis()
    email = "Coach.Example@example.com"

    state = await record_login_failure(redis, "192.0.2.1", email)

    assert state.ip_failures == 1
    assert state.email_failures == 1
    assert all(email not in key for key in redis.values)
    assert set(redis.ttls.values()) == {LOGIN_FAILURE_WINDOW_SECONDS}


@pytest.mark.asyncio
async def test_limits_are_scoped_to_ip_and_normalized_account() -> None:
    redis = FakeRedis()

    for _ in range(LOGIN_EMAIL_FAILURE_LIMIT):
        state = await record_login_failure(redis, "192.0.2.1", "coach@example.com")
    assert state.email_limited
    assert not state.ip_limited

    for _ in range(LOGIN_IP_FAILURE_LIMIT - LOGIN_EMAIL_FAILURE_LIMIT):
        state = await record_login_failure(redis, "192.0.2.1", "another@example.com")
    assert state.ip_limited


@pytest.mark.asyncio
async def test_successful_login_can_clear_account_and_ip_counters() -> None:
    redis = FakeRedis()
    await record_login_failure(redis, "192.0.2.1", "coach@example.com")

    await clear_login_failures(redis, "192.0.2.1", "coach@example.com")
    state = await get_login_failure_state(redis, "192.0.2.1", "coach@example.com")

    assert state.ip_failures == 0
    assert state.email_failures == 0


@pytest.mark.asyncio
async def test_login_route_returns_retry_after_after_repeated_failures(monkeypatch: pytest.MonkeyPatch) -> None:
    redis = FakeRedis()
    monkeypatch.setattr(auth_routes, "get_redis_client", lambda: redis)
    payload = LoginRequest(email="coach@example.com", password="wrong-password")

    for attempt in range(LOGIN_EMAIL_FAILURE_LIMIT):
        with pytest.raises(HTTPException) as error:
            await auth_routes.login(payload, request_from("192.0.2.2"), Response(), FakeDatabase())
        if attempt < LOGIN_EMAIL_FAILURE_LIMIT - 1:
            assert error.value.status_code == 401
        else:
            assert error.value.status_code == 429
            assert int(error.value.headers["Retry-After"]) > 0


@pytest.mark.asyncio
async def test_valid_credentials_can_recover_an_email_limited_account(monkeypatch: pytest.MonkeyPatch) -> None:
    redis = FakeRedis()
    for _ in range(LOGIN_EMAIL_FAILURE_LIMIT):
        await record_login_failure(redis, "192.0.2.3", "coach@example.com")
    user = SimpleNamespace(
        id=uuid4(),
        email="coach@example.com",
        password_hash="not-used-by-test",
        role=UserRole.ADMIN,
        is_active=True,
        instructor_profile=None,
    )
    monkeypatch.setattr(auth_routes, "get_redis_client", lambda: redis)
    monkeypatch.setattr(auth_routes, "verify_password", lambda *_args: True)

    async def create_session(*, user_id: Any, data: dict[str, Any]) -> tuple[str, str]:
        assert user_id == user.id
        assert data["role"] == "admin"
        return "session-value", "csrf-value"

    monkeypatch.setattr(SessionStore, "create_session", create_session)
    response = Response()

    result = await auth_routes.login(
        LoginRequest(email="coach@example.com", password="correct-password"),
        request_from("192.0.2.3"),
        response,
        FakeDatabase(user),
    )

    assert result is user
    state = await get_login_failure_state(redis, "192.0.2.3", "coach@example.com")
    assert state.email_failures == 0
    assert "chess_session_id=session-value" in response.headers["set-cookie"]


@pytest.mark.asyncio
async def test_password_work_sheds_load_when_bounded_queue_is_full(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(auth_routes, "_password_work_slots", threading.Semaphore(0))

    with pytest.raises(HTTPException) as error:
        await auth_routes._run_password_work(lambda: "unused")

    assert error.value.status_code == 503
    assert error.value.headers["Retry-After"] == "1"
