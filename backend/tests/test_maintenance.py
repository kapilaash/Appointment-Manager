from datetime import UTC, datetime, timedelta
from uuid import uuid4

from sqlalchemy import select

from app.auth.models import AccountToken
from app.scheduling.models import OutboxEvent
from app.workers.maintenance import purge_expired_records


async def test_purge_removes_only_old_technical_records(sessions) -> None:
    now = datetime.now(UTC)
    old, recent = now - timedelta(days=45), now - timedelta(days=2)

    def event(status: str, *, created: datetime, processed: datetime | None) -> OutboxEvent:
        return OutboxEvent(event_type="booking.created", aggregate_id=uuid4(), payload={}, processing_status=status,
                           attempt_count=1, created_at=created, processed_at=processed)

    async with sessions() as db:
        db.add_all([
            event("processed", created=old, processed=old),             # removed: finished long ago
            event("processed", created=recent, processed=recent),       # kept: recent
            event("pending", created=old, processed=None),              # kept: still to do
            event("failed", created=old, processed=None),               # kept: failures are kept 90 days
            event("failed", created=now - timedelta(days=120), processed=None),  # removed
            AccountToken(purpose="coach_invitation", token_hash=uuid4().hex, email="a@x.test", expires_at=old),     # removed
            AccountToken(purpose="coach_invitation", token_hash=uuid4().hex, email="b@x.test", expires_at=recent),  # kept
        ])
        await db.commit()

        assert await purge_expired_records(db, now=now) == {"outbox_events": 2, "account_tokens": 1}
        statuses = sorted((await db.scalars(select(OutboxEvent.processing_status))).all())
        assert statuses == ["failed", "pending", "processed"]
        assert (await db.scalars(select(AccountToken.email))).all() == ["b@x.test"]
