from typing import Any, Dict
import structlog
from arq.connections import RedisSettings
from app.core.config import settings

logger = structlog.get_logger()


async def startup(ctx: Dict[str, Any]) -> None:
    logger.info("ARQ Worker initialized. Ready for background tasks.")


async def shutdown(ctx: Dict[str, Any]) -> None:
    logger.info("ARQ Worker shutting down cleanly.")


async def process_outbox_event(ctx: Dict[str, Any], event_id: str) -> str:
    """Dispatches asynchronous notification or meeting task."""
    logger.info("Processing outbox task", event_id=event_id)
    return f"Processed {event_id}"


class WorkerSettings:
    functions = [process_outbox_event]
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = RedisSettings.from_dsn(settings.REDIS_URL)
    max_jobs = 10
    poll_delay = 0.5
