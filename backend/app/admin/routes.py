import smtplib
from datetime import UTC, datetime, timedelta
from typing import Literal
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, ConfigDict, EmailStr, TypeAdapter, ValidationError
from redis.exceptions import RedisError
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.dependencies import require_admin
from app.auth.models import AccountToken
from app.auth.session_store import SessionStore
from app.auth.tokens import issue_token
from app.core.config import settings
from app.core.mailer import build_message, send_message
from app.db.session import get_db_session
from app.scheduling import change_requests as cr
from app.scheduling.models import ChangeRequest
from app.users.models import User, UserRole

router = APIRouter(prefix="/admin/coaches", tags=["Coach administration"])
logger = structlog.get_logger(__name__)
Db = Depends(get_db_session)
Admin = Depends(require_admin)


class CoachInviteIn(BaseModel):
    email: EmailStr


class CoachActiveIn(BaseModel):
    active: bool


class CoachOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    # Existing rows may predate email validation; preserve them in the admin
    # list so one malformed legacy record cannot fail the whole response.
    email: str
    email_valid: bool
    full_name: str
    role: Literal["instructor"]
    is_active: bool
    display_name: str
    timezone: str
    country_code: str | None


class CoachInviteOut(BaseModel):
    email: EmailStr
    registration_url: str
    expires_at: datetime
    email_sent: bool


class PasswordResetLinkOut(BaseModel):
    email: EmailStr
    reset_url: str
    expires_at: datetime
    email_sent: bool


def _one_time_url(path: str, token: str) -> str:
    # Keep bearer tokens in the fragment so they are not sent in HTTP requests or referrers.
    return f"{settings.FRONTEND_URL.rstrip('/')}{path}#token={token}"


def _is_valid_email(value: str) -> bool:
    try:
        TypeAdapter(EmailStr).validate_python(value)
    except ValidationError:
        return False
    return True


async def _email_account_link(recipient: str, purpose: str, url: str) -> bool:
    if purpose == "coach_invitation":
        subject = "Complete your Thirumal Chess Academy coach registration"
        body = (
            "An administrator invited you to join Thirumal Chess Academy as a coach.\n\n"
            f"Complete registration within 48 hours using this one-time link:\n{url}\n\n"
            "If you were not expecting this invitation, you can ignore this email."
        )
    else:
        subject = "Reset your Thirumal Chess Academy coach password"
        body = (
            "An administrator requested a password reset for your coach account.\n\n"
            f"Set a new password within 30 minutes using this one-time link:\n{url}\n\n"
            "If you did not request this, contact the academy administrator."
        )
    try:
        await send_message(build_message(recipient, subject, body))
    except (OSError, smtplib.SMTPException) as exc:
        logger.warning(
            "coach_account_link_email_failed",
            purpose=purpose,
            error_type=type(exc).__name__,
        )
        return False
    logger.info("coach_account_link_email_sent", purpose=purpose)
    return True


@router.get("", response_model=list[CoachOut])
async def list_coaches(db: AsyncSession = Db, _actor: User = Admin) -> list[dict]:
    result = await db.execute(
        select(User)
        # Load profiles in one additional batch query while retaining accounts
        # that predate profile creation. An inner join silently hid those users.
        .options(selectinload(User.instructor_profile))
        .where(User.role == UserRole.INSTRUCTOR)
        .order_by(User.full_name, User.email)
    )
    users = result.scalars().all()
    return [
        {
            "id": user.id,
            "email": user.email,
            "email_valid": _is_valid_email(user.email),
            "full_name": user.full_name,
            "role": "instructor",
            "is_active": user.is_active,
            "display_name": user.instructor_profile.display_name
            if user.instructor_profile
            else user.full_name,
            "timezone": user.instructor_profile.timezone
            if user.instructor_profile
            else "Not configured",
            "country_code": user.instructor_profile.country_code
            if user.instructor_profile
            else None,
        }
        for user in users
    ]


@router.post("/invitations", response_model=CoachInviteOut, status_code=status.HTTP_201_CREATED)
async def invite_coach(
    data: CoachInviteIn,
    db: AsyncSession = Db,
    actor: User = Admin,
) -> dict:
    email = str(data.email).strip().lower()
    existing = await db.scalar(select(User.id).where(User.email == email))
    if existing:
        raise HTTPException(status_code=409, detail="An account already exists for this email")

    now = datetime.now(UTC)
    await db.execute(
        update(AccountToken)
        .where(
            AccountToken.purpose == "coach_invitation",
            AccountToken.email == email,
            AccountToken.consumed_at.is_(None),
            AccountToken.revoked_at.is_(None),
        )
        .values(revoked_at=now)
    )
    token, token_hash = issue_token()
    expires_at = now + timedelta(hours=48)
    db.add(
        AccountToken(
            purpose="coach_invitation",
            token_hash=token_hash,
            email=email,
            created_by_user_id=actor.id,
            expires_at=expires_at,
        )
    )
    await db.commit()
    registration_url = _one_time_url("/register/coach", token)
    email_sent = await _email_account_link(email, "coach_invitation", registration_url)
    return {
        "email": email,
        "registration_url": registration_url,
        "expires_at": expires_at,
        "email_sent": email_sent,
    }


@router.patch("/{user_id}/active", response_model=CoachOut)
async def set_coach_active(
    user_id: UUID,
    data: CoachActiveIn,
    db: AsyncSession = Db,
    _actor: User = Admin,
) -> dict:
    user = await db.scalar(
        select(User)
        .options(selectinload(User.instructor_profile))
        .where(User.id == user_id, User.role == UserRole.INSTRUCTOR)
    )
    if user is None:
        raise HTTPException(status_code=404, detail="Coach account not found")
    user.is_active = data.active
    if not data.active and user.instructor_profile is not None:
        # A deactivated coach can no longer follow up, so close their open requests
        # instead of leaving them in the approval queue forever.
        await db.execute(
            update(ChangeRequest)
            .where(
                ChangeRequest.instructor_id == user.instructor_profile.id,
                ChangeRequest.status == cr.PENDING,
            )
            .values(
                status=cr.WITHDRAWN,
                review_note="Closed automatically: the coach account was deactivated.",
                updated_at=datetime.now(UTC),
            )
        )
    await db.commit()
    if not data.active:
        try:
            await SessionStore.destroy_user_sessions(user.id)
        except RedisError:
            logger.warning("deactivated_coach_session_cleanup_failed", user_id=str(user.id))
    return {
        "id": user.id,
        "email": user.email,
        "email_valid": _is_valid_email(user.email),
        "full_name": user.full_name,
        "role": "instructor",
        "is_active": user.is_active,
        "display_name": user.instructor_profile.display_name
        if user.instructor_profile
        else user.full_name,
        "timezone": user.instructor_profile.timezone
        if user.instructor_profile
        else "Not configured",
        "country_code": user.instructor_profile.country_code if user.instructor_profile else None,
    }


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_coach(
    user_id: UUID,
    db: AsyncSession = Db,
    actor: User = Admin,
) -> Response:
    user = await db.scalar(
        select(User)
        .options(selectinload(User.instructor_profile))
        .where(User.id == user_id, User.role == UserRole.INSTRUCTOR)
    )
    if user is None:
        raise HTTPException(status_code=404, detail="Coach account not found")

    await db.delete(user)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This coach has appointment or other records that must be preserved. Deactivate the account instead.",
        ) from exc

    try:
        await SessionStore.destroy_user_sessions(user_id)
    except RedisError:
        # The database deletion already makes this user unauthorized. Record
        # the cache cleanup problem without reporting a failed deletion.
        logger.warning("deleted_coach_session_cleanup_failed", user_id=str(user_id))

    logger.info(
        "coach_account_deleted",
        actor_id=str(actor.id),
        user_id=str(user_id),
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{user_id}/password-reset", response_model=PasswordResetLinkOut)
async def issue_password_reset(
    user_id: UUID,
    db: AsyncSession = Db,
    actor: User = Admin,
) -> dict:
    user = await db.scalar(select(User).where(User.id == user_id, User.role == UserRole.INSTRUCTOR))
    if user is None:
        raise HTTPException(status_code=404, detail="Coach account not found")
    if not _is_valid_email(user.email):
        raise HTTPException(
            status_code=409,
            detail="This coach account has an invalid email address. Correct it before issuing a reset link.",
        )

    now = datetime.now(UTC)
    await db.execute(
        update(AccountToken)
        .where(
            AccountToken.purpose.in_(("coach_password_reset", "password_reset")),
            AccountToken.user_id == user.id,
            AccountToken.consumed_at.is_(None),
            AccountToken.revoked_at.is_(None),
        )
        .values(revoked_at=now)
    )
    token, token_hash = issue_token()
    expires_at = now + timedelta(minutes=30)
    db.add(
        AccountToken(
            purpose="password_reset",
            token_hash=token_hash,
            email=user.email,
            user_id=user.id,
            created_by_user_id=actor.id,
            expires_at=expires_at,
        )
    )
    await db.commit()
    reset_url = _one_time_url("/reset-password", token)
    email_sent = await _email_account_link(user.email, "coach_password_reset", reset_url)
    return {
        "email": user.email,
        "reset_url": reset_url,
        "expires_at": expires_at,
        "email_sent": email_sent,
    }
