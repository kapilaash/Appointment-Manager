"""Daily housekeeping so the database does not grow without bound.

Only purely technical records are removed: finished background-job rows and expired
one-time links. Booking history, notification history and approval decisions are kept
because staff rely on them.
"""

from datetime import UTC, datetime, timedelta
from typing import Any, cast

import structlog
from sqlalchemy import CursorResult, and_, delete, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import AccountToken
from app.core.config import settings
from app.scheduling.models import OutboxEvent

logger = structlog.get_logger(__name__)


async def purge_expired_records(db: AsyncSession, *, now: datetime | None = None) -> dict[str, int]:
    """Delete finished outbox events and long-expired account tokens; return counts removed."""
    current = now or datetime.now(UTC)
    processed_cutoff = current - timedelta(days=settings.OUTBOX_RETENTION_DAYS)
    failed_cutoff = current - timedelta(days=settings.FAILED_OUTBOX_RETENTION_DAYS)
    token_cutoff = current - timedelta(days=settings.ACCOUNT_TOKEN_RETENTION_DAYS)

    # DELETE statements return a CursorResult, which carries the affected row count.
    outbox = cast(CursorResult[Any], await db.execute(delete(OutboxEvent).where(or_(
        and_(OutboxEvent.processing_status == "processed", OutboxEvent.processed_at < processed_cutoff),
        # Failed events are kept longer so they can still be investigated.
        and_(OutboxEvent.processing_status == "failed", OutboxEvent.created_at < failed_cutoff),
    ))))
    tokens = cast(CursorResult[Any], await db.execute(delete(AccountToken).where(AccountToken.expires_at < token_cutoff)))
    await db.commit()
    return {"outbox_events": outbox.rowcount or 0, "account_tokens": tokens.rowcount or 0}


async def run_purge(_ctx: dict[str, Any]) -> dict[str, int]:
    # Imported lazily so this module stays importable without a configured database.
    from app.db.session import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        removed = await purge_expired_records(db)
    logger.info("maintenance_purge_completed", **removed)
    return removed
