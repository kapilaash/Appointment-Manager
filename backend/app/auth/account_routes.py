"""Self-service account security: change password and two-step sign-in."""

from datetime import UTC, datetime

import structlog
from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, status
from redis.exceptions import RedisError
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import mfa
from app.auth.dependencies import get_current_user
from app.auth.models import AccountToken
from app.auth.notices import (
    MFA_DISABLED,
    MFA_ENABLED,
    PASSWORD_CHANGED,
    RECOVERY_CODES_REGENERATED,
    queue_account_notice,
)
from app.auth.passwords import password_problem
from app.auth.rate_limit import clear_login_failures, get_login_failure_state, record_login_failure
from app.auth.routes import RESET_PURPOSES, _run_password_work, verify_second_factor
from app.auth.schemas import (
    MfaCodeIn,
    MfaDisableIn,
    MfaSetupOut,
    PasswordChangeIn,
    PasswordConfirmIn,
    RecoveryCodesOut,
)
from app.auth.session_store import SessionStore, get_redis_client
from app.core.config import settings
from app.core.security import hash_password, verify_password
from app.db.session import get_db_session
from app.users.models import User

router = APIRouter(prefix="/auth/me", tags=["Account security"])
logger = structlog.get_logger(__name__)
MFA_SETUP_PREFIX = "mfa-setup:"
MFA_SETUP_TTL_SECONDS = 10 * 60


async def _confirm_password(request: Request, user: User, password: str) -> None:
    """Re-check the password before sensitive changes; wrong guesses count toward sign-in limits."""
    redis = get_redis_client()
    client_ip = request.client.host if request.client else "unknown"
    try:
        state = await get_login_failure_state(redis, client_ip, user.email)
    except RedisError as exc:
        raise HTTPException(503, "This is temporarily unavailable. Try again shortly.") from exc
    if state.email_limited or state.ip_limited:
        raise HTTPException(429, "Too many incorrect passwords. Wait a little and try again.")
    if not await _run_password_work(verify_password, password, user.password_hash):
        try:
            await record_login_failure(redis, client_ip, user.email)
        except RedisError:
            logger.warning("password_confirmation_counter_failed")
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Your current password is not correct.")
    try:
        await clear_login_failures(redis, client_ip, user.email)
    except RedisError:
        logger.warning("password_confirmation_counter_cleanup_failed")


@router.post("/password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(
    payload: PasswordChangeIn,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
    session_id: str | None = Cookie(default=None, alias=settings.SESSION_COOKIE_NAME),
) -> None:
    await _confirm_password(request, user, payload.current_password)
    if payload.new_password == payload.current_password:
        raise HTTPException(422, "Choose a new password that is different from your current one.")
    problem = password_problem(payload.new_password, email=user.email)
    if problem:
        raise HTTPException(422, problem)
    now = datetime.now(UTC)
    user.password_hash = await _run_password_work(hash_password, payload.new_password)
    user.password_changed_at = now
    # Any reset link still in someone's inbox should stop working.
    await db.execute(
        update(AccountToken)
        .where(AccountToken.user_id == user.id, AccountToken.purpose.in_(RESET_PURPOSES), AccountToken.consumed_at.is_(None))
        .values(revoked_at=now)
    )
    queue_account_notice(db, user, PASSWORD_CHANGED)
    await db.commit()
    try:
        # Sign out every other device; this one stays signed in.
        await SessionStore.destroy_user_sessions(user.id, keep_session_id=session_id)
    except RedisError:
        logger.exception("password_change_session_cleanup_failed", user_id=str(user.id))
    logger.info("password_changed", user_id=str(user.id))


@router.post("/mfa/setup", response_model=MfaSetupOut)
async def start_mfa_setup(user: User = Depends(get_current_user)) -> MfaSetupOut:
    """Create a new authenticator secret; it is only saved once the user proves it works."""
    if user.mfa_enabled:
        raise HTTPException(409, "Two-step sign-in is already on.")
    secret = mfa.new_secret()
    try:
        await get_redis_client().setex(f"{MFA_SETUP_PREFIX}{user.id}", MFA_SETUP_TTL_SECONDS, mfa.encrypt_secret(secret))
    except RedisError as exc:
        raise HTTPException(503, "This is temporarily unavailable. Try again shortly.") from exc
    return MfaSetupOut(secret=secret, otpauth_uri=mfa.provisioning_uri(secret, user.email))


@router.post("/mfa/enable", response_model=RecoveryCodesOut)
async def enable_mfa(
    payload: MfaCodeIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> RecoveryCodesOut:
    redis = get_redis_client()
    try:
        pending = await redis.get(f"{MFA_SETUP_PREFIX}{user.id}")
    except RedisError as exc:
        raise HTTPException(503, "This is temporarily unavailable. Try again shortly.") from exc
    secret = mfa.decrypt_secret(pending) if pending else None
    if secret is None:
        raise HTTPException(410, "Setup timed out. Start again to get a new QR code.")
    if mfa.matching_time_step(secret, payload.code) is None:
        raise HTTPException(400, "That code is not right. Check the time on your phone and try the newest code.")
    codes = mfa.new_recovery_codes()
    user.mfa_secret_encrypted = mfa.encrypt_secret(secret)
    user.mfa_enabled_at = datetime.now(UTC)
    user.mfa_recovery_code_hashes = [mfa.hash_recovery_code(code) for code in codes]
    queue_account_notice(db, user, MFA_ENABLED)
    await db.commit()
    await redis.delete(f"{MFA_SETUP_PREFIX}{user.id}")
    logger.info("mfa_enabled", user_id=str(user.id))
    return RecoveryCodesOut(recovery_codes=codes)


@router.post("/mfa/disable", status_code=status.HTTP_204_NO_CONTENT)
async def disable_mfa(
    payload: MfaDisableIn,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> None:
    if not user.mfa_enabled:
        return
    await _confirm_password(request, user, payload.password)
    if not await verify_second_factor(get_redis_client(), db, user, payload.code):
        raise HTTPException(400, "That code is not right. Use a current authenticator code or a recovery code.")
    user.mfa_secret_encrypted = None
    user.mfa_enabled_at = None
    user.mfa_recovery_code_hashes = None
    queue_account_notice(db, user, MFA_DISABLED)
    await db.commit()
    logger.info("mfa_disabled", user_id=str(user.id))


@router.post("/mfa/recovery-codes", response_model=RecoveryCodesOut)
async def regenerate_recovery_codes(
    payload: PasswordConfirmIn,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> RecoveryCodesOut:
    if not user.mfa_enabled:
        raise HTTPException(409, "Turn on two-step sign-in first.")
    await _confirm_password(request, user, payload.password)
    codes = mfa.new_recovery_codes()
    user.mfa_recovery_code_hashes = [mfa.hash_recovery_code(code) for code in codes]
    queue_account_notice(db, user, RECOVERY_CODES_REGENERATED)
    await db.commit()
    return RecoveryCodesOut(recovery_codes=codes)


@router.get("/security")
async def security_overview(user: User = Depends(get_current_user)) -> dict:
    return {
        "mfa_enabled": user.mfa_enabled,
        "mfa_enabled_at": user.mfa_enabled_at.isoformat() if user.mfa_enabled_at else None,
        "recovery_codes_remaining": len(user.mfa_recovery_code_hashes or []) if user.mfa_enabled else 0,
        "password_changed_at": user.password_changed_at.isoformat() if user.password_changed_at else None,
    }

