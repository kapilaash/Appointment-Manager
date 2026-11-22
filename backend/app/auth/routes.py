import asyncio
import hashlib
import hmac
import json
import secrets
import smtplib
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from functools import partial
from typing import Any
from uuid import UUID

import structlog
from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from redis.exceptions import RedisError
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth import mfa
from app.auth.dependencies import get_current_user
from app.auth.models import AccountToken
from app.auth.notices import PASSWORD_CHANGED, queue_account_notice
from app.auth.passwords import password_problem
from app.auth.rate_limit import clear_login_failures, get_login_failure_state, record_login_failure
from app.auth.schemas import (
    CoachInvitationOut,
    CoachInvitationTokenIn,
    CoachRegistrationIn,
    LoginRequest,
    MessageResponse,
    MfaChallengeOut,
    MfaLoginIn,
    PasswordResetIn,
    PasswordResetRequestIn,
    PreferencesIn,
    UserResponse,
)
from app.auth.session_store import SessionStore, get_redis_client
from app.auth.tokens import issue_token, token_digest
from app.core.config import settings
from app.core.mailer import build_message, send_message
from app.core.security import hash_password, verify_password
from app.db.session import get_db_session
from app.users.models import Instructor, User, UserRole

router = APIRouter(prefix="/auth", tags=["Authentication"])
logger = structlog.get_logger(__name__)
_password_hash_executor = ThreadPoolExecutor(
    max_workers=settings.AUTH_PASSWORD_HASH_WORKERS,
    thread_name_prefix="password-hash",
)
_password_work_slots = threading.BoundedSemaphore(settings.AUTH_PASSWORD_HASH_WORKERS * 2)


async def _run_password_work(function, *args):
    """Run password work off-loop with a bounded queue to shed excess load."""
    loop = asyncio.get_running_loop()
    if not _password_work_slots.acquire(blocking=False):
        logger.warning("password_work_capacity_exceeded")
        raise HTTPException(
            status_code=503,
            detail="Authentication is busy. Try again shortly.",
            headers={"Retry-After": "1"},
        )

    try:
        work = loop.run_in_executor(_password_hash_executor, partial(function, *args))
    except BaseException:
        _password_work_slots.release()
        raise

    work.add_done_callback(lambda _work: _password_work_slots.release())
    return await asyncio.shield(work)


async def _allow_password_reset_request(client_ip: str, email: str) -> bool:
    redis = get_redis_client()
    ip_hash = hashlib.sha256(client_ip.encode()).hexdigest()
    email_hash = hashlib.sha256(email.encode()).hexdigest()
    pipeline = redis.pipeline(transaction=True)
    pipeline.incr(f"password-reset:ip:{ip_hash}")
    pipeline.expire(f"password-reset:ip:{ip_hash}", 600, nx=True)
    pipeline.incr(f"password-reset:email:{email_hash}")
    pipeline.expire(f"password-reset:email:{email_hash}", 60, nx=True)
    results = await pipeline.execute()
    return int(results[0]) <= 10 and int(results[2]) <= 1


MFA_CHALLENGE_PREFIX = "mfa-challenge:"
MFA_CHALLENGE_TTL_SECONDS = 5 * 60
MFA_MAX_ATTEMPTS = 5


def start_session_cookies(response: Response, session_id: str, csrf_token: str) -> None:
    secure = settings.ENVIRONMENT == "production"
    # HttpOnly session cookie: never readable by page scripts.
    response.set_cookie(
        key=settings.SESSION_COOKIE_NAME, value=session_id, max_age=settings.SESSION_MAX_AGE_SECONDS,
        httponly=True, secure=secure, samesite="lax", path="/",
    )
    # Readable CSRF cookie, echoed back by the client in the X-CSRF-Token header.
    response.set_cookie(
        key="csrf_token", value=csrf_token, max_age=settings.SESSION_MAX_AGE_SECONDS,
        httponly=False, secure=secure, samesite="lax", path="/",
    )


async def _sign_in(response: Response, user: User) -> User:
    session_id, csrf_token = await SessionStore.create_session(
        user_id=user.id, data={"email": user.email, "role": user.role.value}
    )
    start_session_cookies(response, session_id, csrf_token)
    return user


@router.post("/login", response_model=None)
async def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db_session)
) -> UserResponse | MfaChallengeOut:
    client_ip = request.client.host if request.client else "unknown"
    email = payload.email.strip().lower()
    redis = get_redis_client()
    try:
        failure_state = await get_login_failure_state(redis, client_ip, email)
    except RedisError as exc:
        raise HTTPException(503, "Sign-in is temporarily unavailable. Try again shortly.") from exc
    if failure_state.ip_limited:
        logger.warning("login_rate_limited", scope="source")
        raise HTTPException(
            status_code=429,
            detail="Too many sign-in attempts. Wait a little and try again.",
            headers={"Retry-After": str(failure_state.ip_retry_after)},
        )
    stmt = (
        select(User)
        .options(selectinload(User.instructor_profile))
        .where(User.email == email)
    )
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()

    password_valid = (
        await _run_password_work(verify_password, payload.password, user.password_hash)
        if user
        else False
    )
    if not user or not password_valid:
        await _record_failed_attempt(redis, client_ip, email, failure_state)
        logger.info("login_failed", reason="invalid_credentials")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password"
        )

    try:
        await clear_login_failures(redis, client_ip, email)
    except RedisError:
        logger.warning("login_failure_counter_cleanup_failed")

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account has been deactivated"
        )

    if user.mfa_enabled:
        # Password is right; a second step is still needed. No session exists until it succeeds.
        challenge = secrets.token_urlsafe(32)
        try:
            await redis.setex(
                f"{MFA_CHALLENGE_PREFIX}{challenge}", MFA_CHALLENGE_TTL_SECONDS,
                json.dumps({"user_id": str(user.id), "attempts": 0}),
            )
        except RedisError as exc:
            raise HTTPException(503, "Sign-in is temporarily unavailable. Try again shortly.") from exc
        return MfaChallengeOut(mfa_token=challenge)

    return UserResponse.model_validate(await _sign_in(response, user))


async def _record_failed_attempt(redis: Any, client_ip: str, email: str, failure_state: Any) -> None:
    try:
        failure_state = failure_state if failure_state.email_limited else await record_login_failure(redis, client_ip, email)
    except RedisError as exc:
        raise HTTPException(503, "Sign-in is temporarily unavailable. Try again shortly.") from exc
    if failure_state.email_limited or failure_state.ip_limited:
        logger.warning("login_rate_limited", scope="account" if failure_state.email_limited else "source")
        retry_after = max(failure_state.email_retry_after, failure_state.ip_retry_after)
        raise HTTPException(
            status_code=429,
            detail="Too many sign-in attempts. Wait a little and try again.",
            headers={"Retry-After": str(retry_after)},
        )


async def verify_second_factor(redis: Any, db: AsyncSession, user: User, code: str) -> bool:
    """Accept a current authenticator code (each used once) or an unused recovery code."""
    secret = mfa.decrypt_secret(user.mfa_secret_encrypted or "")
    if secret is not None:
        step = mfa.matching_time_step(secret, code)
        if step is not None:
            # Refuse a code that was already used, even within its 90-second validity window.
            first_use = await redis.set(f"mfa-used:{user.id}:{step}", "1", ex=120, nx=True)
            return bool(first_use)
    hashes = list(user.mfa_recovery_code_hashes or [])
    candidate = mfa.hash_recovery_code(code)
    for stored in hashes:
        if hmac.compare_digest(stored, candidate):
            hashes.remove(stored)
            user.mfa_recovery_code_hashes = hashes
            await db.commit()
            logger.info("mfa_recovery_code_used", user_id=str(user.id), remaining=len(hashes))
            return True
    return False


@router.post("/login/mfa", response_model=UserResponse)
async def login_second_step(
    payload: MfaLoginIn,
    response: Response,
    db: AsyncSession = Depends(get_db_session),
):
    redis = get_redis_client()
    key = f"{MFA_CHALLENGE_PREFIX}{payload.mfa_token}"
    expired = HTTPException(status_code=401, detail="This sign-in attempt expired. Enter your email and password again.")
    try:
        raw = await redis.get(key)
        if not raw:
            raise expired
        challenge = json.loads(raw)
        user = await db.scalar(
            select(User).options(selectinload(User.instructor_profile)).where(User.id == UUID(challenge["user_id"]))
        )
        if user is None or not user.is_active or not user.mfa_enabled:
            await redis.delete(key)
            raise expired
        if not await verify_second_factor(redis, db, user, payload.code):
            challenge["attempts"] += 1
            if challenge["attempts"] >= MFA_MAX_ATTEMPTS:
                await redis.delete(key)
                logger.warning("mfa_attempts_exhausted", user_id=str(user.id))
                raise HTTPException(status_code=429, detail="Too many incorrect codes. Sign in again to get a new attempt.")
            await redis.set(key, json.dumps(challenge), keepttl=True)
            raise HTTPException(status_code=400, detail="That code is not right. Check your authenticator app and try again.")
        await redis.delete(key)
    except RedisError as exc:
        raise HTTPException(503, "Sign-in is temporarily unavailable. Try again shortly.") from exc
    return await _sign_in(response, user)


@router.post("/logout", response_model=MessageResponse)
async def logout(
    response: Response,
    chess_session_id: str | None = Cookie(default=None, alias=settings.SESSION_COOKIE_NAME),
    _user: User = Depends(get_current_user),
):
    if chess_session_id:
        await SessionStore.destroy_session(chess_session_id)

    response.delete_cookie(settings.SESSION_COOKIE_NAME, path="/")
    response.delete_cookie("csrf_token", path="/")
    return MessageResponse(message="Successfully logged out")


@router.get("/me", response_model=UserResponse)
async def get_my_profile(current_user: User = Depends(get_current_user)):
    return current_user


@router.put("/me/preferences", response_model=UserResponse)
async def update_my_preferences(
    payload: PreferencesIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
):
    current_user.theme_preference = payload.theme
    await db.commit()
    return current_user


@router.post("/coach-invitation/validate", response_model=CoachInvitationOut)
async def validate_coach_invitation(
    payload: CoachInvitationTokenIn,
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, object]:
    now = datetime.now(UTC)
    token = await db.scalar(select(AccountToken).where(
        AccountToken.token_hash == token_digest(payload.token),
        AccountToken.purpose == "coach_invitation",
        AccountToken.consumed_at.is_(None),
        AccountToken.revoked_at.is_(None),
        AccountToken.expires_at > now,
    ))
    if token is None:
        raise HTTPException(status_code=400, detail="Invitation is invalid, expired, or already used")
    return {"email": token.email, "expires_at": token.expires_at}


@router.post("/coach-register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def register_coach(
    payload: CoachRegistrationIn,
    db: AsyncSession = Depends(get_db_session),
) -> User:
    now = datetime.now(UTC)
    token = await db.scalar(select(AccountToken).where(
        AccountToken.token_hash == token_digest(payload.token),
        AccountToken.purpose == "coach_invitation",
        AccountToken.consumed_at.is_(None),
        AccountToken.revoked_at.is_(None),
        AccountToken.expires_at > now,
    ).with_for_update())
    if token is None:
        raise HTTPException(status_code=400, detail="Invitation is invalid, expired, or already used")

    email = token.email.strip().lower()
    if await db.scalar(select(User.id).where(User.email == email)):
        raise HTTPException(status_code=409, detail="An account already exists for this invitation")

    user = User(
        email=email,
        password_hash=await _run_password_work(hash_password, payload.password),
        role=UserRole.INSTRUCTOR,
        full_name=payload.full_name,
        is_active=True,
    )
    db.add(user)
    try:
        await db.flush()
        instructor = Instructor(
            user_id=user.id,
            display_name=payload.display_name,
            timezone=payload.timezone,
            country_code=payload.country_code,
            is_available_for_booking=True,
        )
        db.add(instructor)
        user.instructor_profile = instructor
        token.consumed_at = now
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail="An account already exists for this invitation") from exc
    return user


RESET_PURPOSES = ("password_reset", "coach_password_reset")
RESET_LINK_MINUTES = 30


@router.post("/password-reset", status_code=status.HTTP_204_NO_CONTENT)
@router.post("/coach-password-reset", status_code=status.HTTP_204_NO_CONTENT, include_in_schema=False)
async def reset_password(
    payload: PasswordResetIn,
    db: AsyncSession = Depends(get_db_session),
) -> None:
    """Set a new password with a one-time emailed link. Works for every role."""
    now = datetime.now(UTC)
    token = await db.scalar(select(AccountToken).where(
        AccountToken.token_hash == token_digest(payload.token),
        AccountToken.purpose.in_(RESET_PURPOSES),
        AccountToken.consumed_at.is_(None),
        AccountToken.revoked_at.is_(None),
        AccountToken.expires_at > now,
    ).with_for_update())
    invalid = HTTPException(status_code=400, detail="Reset link is invalid, expired, or already used")
    if token is None or token.user_id is None:
        raise invalid

    user = await db.scalar(select(User).where(User.id == token.user_id, User.email == token.email))
    if user is None:
        raise invalid
    problem = password_problem(payload.password, email=user.email)
    if problem:
        raise HTTPException(status_code=422, detail=problem)

    user.password_hash = await _run_password_work(hash_password, payload.password)
    user.password_changed_at = now
    token.consumed_at = now
    queue_account_notice(db, user, PASSWORD_CHANGED)
    await db.commit()
    try:
        await SessionStore.destroy_user_sessions(user.id)
    except RedisError:
        logger.exception("password_reset_session_cleanup_failed", user_id=str(user.id))


@router.post("/password-reset-request", response_model=MessageResponse)
@router.post("/coach-password-reset-request", response_model=MessageResponse, include_in_schema=False)
async def request_password_reset(
    payload: PasswordResetRequestIn,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
) -> MessageResponse:
    """Email a one-time reset link. The answer is identical whether or not the account exists."""
    message = "If an active account matches that email, password reset instructions will be sent."
    email = str(payload.email).strip().lower()
    try:
        allowed = await _allow_password_reset_request(
            request.client.host if request.client else "unknown",
            email,
        )
    except RedisError as exc:
        raise HTTPException(503, "Password reset is temporarily unavailable. Try again shortly.") from exc
    if not allowed:
        return MessageResponse(message=message)

    user = await db.scalar(select(User).where(User.email == email, User.is_active.is_(True)))
    if user is None:
        return MessageResponse(message=message)

    now = datetime.now(UTC)
    await db.execute(
        update(AccountToken)
        .where(
            AccountToken.purpose.in_(RESET_PURPOSES),
            AccountToken.user_id == user.id,
            AccountToken.consumed_at.is_(None),
            AccountToken.revoked_at.is_(None),
        )
        .values(revoked_at=now)
    )
    token, token_hash = issue_token()
    db.add(AccountToken(
        purpose="password_reset",
        token_hash=token_hash,
        email=email,
        user_id=user.id,
        expires_at=now + timedelta(minutes=RESET_LINK_MINUTES),
    ))
    await db.commit()

    # The token sits in the URL fragment, so it never reaches server logs or referrers.
    reset_url = f"{settings.FRONTEND_URL.rstrip('/')}/reset-password#token={token}"
    email_message = build_message(
        email,
        "Reset your Thirumal Chess Academy password",
        f"Hello {user.full_name},\n\n"
        "A password reset was requested for your account.\n\n"
        f"Set a new password within {RESET_LINK_MINUTES} minutes using this one-time link:\n{reset_url}\n\n"
        "Your username is this email address.\n"
        "If you did not request this, you can ignore this email; your password stays the same.",
    )
    try:
        await send_message(email_message)
    except (OSError, smtplib.SMTPException) as exc:
        await db.execute(
            update(AccountToken).where(AccountToken.token_hash == token_hash).values(revoked_at=datetime.now(UTC))
        )
        await db.commit()
        logger.warning("password_reset_email_failed", error_type=type(exc).__name__)
        return MessageResponse(message=message)

    logger.info("password_reset_email_sent", role=user.role.value)
    return MessageResponse(message=message)
