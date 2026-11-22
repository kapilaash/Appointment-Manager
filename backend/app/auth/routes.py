import asyncio
import hashlib
import smtplib
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from functools import partial

import structlog
from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from redis.exceptions import RedisError
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.dependencies import get_current_user
from app.auth.models import AccountToken
from app.auth.rate_limit import clear_login_failures, get_login_failure_state, record_login_failure
from app.auth.schemas import (
    CoachInvitationOut,
    CoachInvitationTokenIn,
    CoachPasswordResetIn,
    CoachPasswordResetRequestIn,
    CoachRegistrationIn,
    LoginRequest,
    MessageResponse,
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
    pipeline.incr(f"coach-reset:ip:{ip_hash}")
    pipeline.expire(f"coach-reset:ip:{ip_hash}", 600, nx=True)
    pipeline.incr(f"coach-reset:email:{email_hash}")
    pipeline.expire(f"coach-reset:email:{email_hash}", 60, nx=True)
    results = await pipeline.execute()
    return int(results[0]) <= 10 and int(results[2]) <= 1


@router.post("/login", response_model=UserResponse)
async def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db_session)
):
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
        try:
            failure_state = failure_state if failure_state.email_limited else await record_login_failure(
                redis, client_ip, email
            )
        except RedisError as exc:
            raise HTTPException(503, "Sign-in is temporarily unavailable. Try again shortly.") from exc
        if failure_state.email_limited or failure_state.ip_limited:
            logger.warning(
                "login_rate_limited",
                scope="account" if failure_state.email_limited else "source",
            )
            retry_after = max(failure_state.email_retry_after, failure_state.ip_retry_after)
            raise HTTPException(
                status_code=429,
                detail="Too many sign-in attempts. Wait a little and try again.",
                headers={"Retry-After": str(retry_after)},
            )
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

    session_id, csrf_token = await SessionStore.create_session(
        user_id=user.id,
        data={"email": user.email, "role": user.role.value}
    )

    # Set secure HttpOnly session cookie
    response.set_cookie(
        key=settings.SESSION_COOKIE_NAME,
        value=session_id,
        max_age=settings.SESSION_MAX_AGE_SECONDS,
        httponly=True,
        secure=(settings.ENVIRONMENT == "production"),
        samesite="lax",
        path="/"
    )

    # Set readable CSRF cookie for client header submission
    response.set_cookie(
        key="csrf_token",
        value=csrf_token,
        max_age=settings.SESSION_MAX_AGE_SECONDS,
        httponly=False,
        secure=(settings.ENVIRONMENT == "production"),
        samesite="lax",
        path="/"
    )

    return user


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


@router.post("/coach-password-reset", status_code=status.HTTP_204_NO_CONTENT)
async def reset_coach_password(
    payload: CoachPasswordResetIn,
    db: AsyncSession = Depends(get_db_session),
) -> None:
    now = datetime.now(UTC)
    token = await db.scalar(select(AccountToken).where(
        AccountToken.token_hash == token_digest(payload.token),
        AccountToken.purpose == "coach_password_reset",
        AccountToken.consumed_at.is_(None),
        AccountToken.revoked_at.is_(None),
        AccountToken.expires_at > now,
    ).with_for_update())
    if token is None or token.user_id is None:
        raise HTTPException(status_code=400, detail="Reset link is invalid, expired, or already used")

    user = await db.scalar(select(User).where(
        User.id == token.user_id,
        User.email == token.email,
        User.role == UserRole.INSTRUCTOR,
    ))
    if user is None:
        raise HTTPException(status_code=400, detail="Reset link is invalid, expired, or already used")

    user.password_hash = await _run_password_work(hash_password, payload.password)
    token.consumed_at = now
    await db.commit()
    try:
        await SessionStore.destroy_user_sessions(user.id)
    except RedisError:
        logger.exception("password_reset_session_cleanup_failed", user_id=str(user.id))


@router.post("/coach-password-reset-request", response_model=MessageResponse)
async def request_coach_password_reset(
    payload: CoachPasswordResetRequestIn,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
) -> MessageResponse:
    message = "If an active coach account matches that email, password reset instructions will be sent."
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

    user = await db.scalar(select(User).where(
        User.email == email,
        User.role == UserRole.INSTRUCTOR,
        User.is_active.is_(True),
    ))
    if user is None:
        return MessageResponse(message=message)

    now = datetime.now(UTC)
    await db.execute(
        update(AccountToken)
        .where(
            AccountToken.purpose == "coach_password_reset",
            AccountToken.user_id == user.id,
            AccountToken.consumed_at.is_(None),
            AccountToken.revoked_at.is_(None),
        )
        .values(revoked_at=now)
    )
    token, token_hash = issue_token()
    expires_at = now + timedelta(minutes=30)
    db.add(AccountToken(
        purpose="coach_password_reset",
        token_hash=token_hash,
        email=email,
        user_id=user.id,
        expires_at=expires_at,
    ))
    await db.commit()

    reset_url = f"{settings.FRONTEND_URL.rstrip('/')}/reset/coach#token={token}"
    email_message = build_message(
        email,
        "Reset your Thirumal Chess Academy coach password",
        "A password reset was requested for your coach account.\n\n"
        f"Set a new password within 30 minutes using this one-time link:\n{reset_url}\n\n"
        "If you did not request this, you can ignore this email.",
    )
    try:
        await send_message(email_message)
    except (OSError, smtplib.SMTPException) as exc:
        await db.execute(
            update(AccountToken).where(AccountToken.token_hash == token_hash).values(revoked_at=datetime.now(UTC))
        )
        await db.commit()
        logger.warning("coach_password_reset_email_failed", error_type=type(exc).__name__)
        return MessageResponse(message=message)

    logger.info("coach_password_reset_email_sent")
    return MessageResponse(message=message)
