import asyncio
from contextlib import asynccontextmanager

import httpx
import structlog
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from prometheus_client import make_asgi_app
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.core.config import settings
from app.observability.error_tracking import configure_error_tracking

configure_error_tracking()

from app.admin.routes import router as coach_admin_router
from app.auth.account_routes import router as account_router
from app.auth.routes import router as auth_router
from app.auth.session_store import close_redis_client, get_redis_client
from app.core.logging import setup_logging
from app.db.session import engine
from app.observability.metrics import (
    API_UPTIME_HEARTBEAT_ENABLED,
    API_UPTIME_HEARTBEAT_SUCCESS,
    RequestMetricsMiddleware,
)
from app.scheduling.requests_routes import router as change_requests_router
from app.scheduling.routes import router as scheduling_router

setup_logging()
logger = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting up Chess Academy API backend", environment=settings.ENVIRONMENT)
    heartbeat_task = None
    API_UPTIME_HEARTBEAT_ENABLED.set(1 if settings.UPTIME_API_HEARTBEAT_URL else 0)
    if settings.UPTIME_API_HEARTBEAT_URL:
        API_UPTIME_HEARTBEAT_SUCCESS.set(0)
        heartbeat_task = asyncio.create_task(_api_uptime_heartbeat_loop())
    try:
        yield
    finally:
        if heartbeat_task is not None:
            heartbeat_task.cancel()
            try:
                await heartbeat_task
            except asyncio.CancelledError:
                pass
        await close_redis_client()
        await engine.dispose()
        logger.info("Shutting down Chess Academy API backend")


async def _api_uptime_heartbeat_loop() -> None:
    async with httpx.AsyncClient(timeout=5) as client:
        while True:
            try:
                await health_ready()
                response = await client.get(settings.UPTIME_API_HEARTBEAT_URL)
                response.raise_for_status()
                API_UPTIME_HEARTBEAT_SUCCESS.set(1)
            except Exception as exc:  # noqa: BLE001 - uptime delivery failures are exposed as a metric.
                API_UPTIME_HEARTBEAT_SUCCESS.set(0)
                logger.warning("external_uptime_heartbeat_failed", error_type=type(exc).__name__)
            await asyncio.sleep(settings.UPTIME_HEARTBEAT_INTERVAL_SECONDS)


app = FastAPI(
    title="Chess Academy Scheduling Platform API",
    version="1.0.0",
    description="High-reliability scheduling engine with PostgreSQL GiST exclusion double-booking prevention.",
    docs_url="/docs" if settings.ENVIRONMENT != "production" else None,
    openapi_url="/openapi.json" if settings.ENVIRONMENT != "production" else None,
    redoc_url=None,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[str(origin).rstrip("/") for origin in settings.CORS_ORIGINS],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=[
        "Content-Type",
        "X-CSRF-Token",
        "X-Request-ID",
        "Idempotency-Key",
        "sentry-trace",
        "baggage",
    ],
    expose_headers=["X-CSRF-Token", "X-Request-ID"],
)

# Register API v1 modules
app.include_router(auth_router, prefix="/api/v1")
app.include_router(account_router, prefix="/api/v1")
app.include_router(coach_admin_router, prefix="/api/v1")
app.include_router(scheduling_router)
app.include_router(change_requests_router)
app.add_middleware(RequestMetricsMiddleware)
app.mount("/metrics", make_asgi_app())


@app.get("/health/live", tags=["System"])
async def health_live() -> dict[str, str]:
    return {"status": "alive"}


@app.get("/health/ready", tags=["System"])
@app.get("/health", tags=["System"], include_in_schema=False)
async def health_ready() -> dict[str, str]:
    try:
        async with engine.connect() as connection:
            await connection.execute(text("SELECT 1"))
    except SQLAlchemyError as exc:
        logger.error("readiness_database_check_failed", error_type=type(exc).__name__)
        raise HTTPException(status_code=503, detail="Database is unavailable") from exc

    try:
        await get_redis_client().ping()
    except Exception as exc:
        logger.error("readiness_redis_check_failed", error_type=type(exc).__name__)
        raise HTTPException(status_code=503, detail="Session store is unavailable") from exc

    return {"status": "ready", "database": "connected", "session_store": "connected"}


@app.get("/api/v1", tags=["System"])
async def root_api():
    return {
        "message": "Welcome to Chess Academy API v1",
        "docs": "/docs" if settings.ENVIRONMENT != "production" else "disabled",
    }
