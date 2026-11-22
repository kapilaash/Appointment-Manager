"""Account security emails ("your password was changed"), delivered through the outbox."""

from sqlalchemy.ext.asyncio import AsyncSession

from app.scheduling.models import OutboxEvent
from app.users.models import User

ACCOUNT_EVENT_PREFIX = "account."
PASSWORD_CHANGED = "account.password_changed"
MFA_ENABLED = "account.mfa_enabled"
MFA_DISABLED = "account.mfa_disabled"
RECOVERY_CODES_REGENERATED = "account.recovery_codes_regenerated"

SUBJECTS = {
    PASSWORD_CHANGED: "Your Thirumal Chess Academy password was changed",
    MFA_ENABLED: "Two-step sign-in is now on for your account",
    MFA_DISABLED: "Two-step sign-in was turned off for your account",
    RECOVERY_CODES_REGENERATED: "New two-step sign-in recovery codes were created",
}

BODIES = {
    PASSWORD_CHANGED: "The password for your Thirumal Chess Academy account was just changed.",
    MFA_ENABLED: "Two-step sign-in was turned on. Signing in now also needs a code from your authenticator app.",
    MFA_DISABLED: "Two-step sign-in was turned off. Signing in now needs only your password.",
    RECOVERY_CODES_REGENERATED: "New recovery codes were created for your account. Your previous codes no longer work.",
}


def queue_account_notice(db: AsyncSession, user: User, event_type: str) -> None:
    """Stage a security email in the same transaction as the change it reports."""
    db.add(
        OutboxEvent(
            event_type=event_type,
            aggregate_id=user.id,
            payload={"user_id": str(user.id)},
            processing_status="pending",
            attempt_count=0,
        )
    )


def account_notice_email(event_type: str, *, name: str, reset_url: str) -> tuple[str, str]:
    subject = SUBJECTS.get(event_type)
    if subject is None:
        raise ValueError(f"Unsupported account event: {event_type}")
    body = (
        f"Hello {name},\n\n{BODIES[event_type]}\n\n"
        "If this was you, no action is needed.\n"
        f"If it was not you, reset your password right away: {reset_url}\n"
        "and tell your academy administrator.\n"
    )
    return subject, body
