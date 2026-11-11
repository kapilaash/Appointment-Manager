from contextlib import asynccontextmanager
from collections.abc import AsyncIterator
from logging import getLogger
from time import perf_counter
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from redis import Redis, RedisError
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from starlette.middleware.base import RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

from app.core.config import get_settings
from app.api.routes import auth, integrations, scheduling
from app.db.session import engine
from app.observability.logging import configure_logging

settings = get_settings()
configure_logging(settings.log_level)
if settings.app_env == "production":
    if not settings.session_cookie_secure:
        raise RuntimeError("SESSION_COOKIE_SECURE must be enabled in production")
    if len(settings.csrf_secret) < 32 or "local" in settings.csrf_secret.lower():
        raise RuntimeError("CSRF_SECRET must be changed in production")
    if settings.meeting_provider == "mock":
        raise RuntimeError("A real meeting provider must be configured in production")
    if settings.email_provider != "gmail":
        raise RuntimeError("An authorized production email provider must be configured")
    if not settings.google_client_id or not settings.google_client_secret or not settings.encryption_key:
        raise RuntimeError("Google OAuth credentials and an encryption key are required in production")


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    yield
    engine.dispose()


app = FastAPI(title="Chess Academy Scheduling API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-CSRF-Token", "X-Request-ID", "Idempotency-Key"],
)
app.include_router(auth.router, prefix="/api/v1")
app.include_router(scheduling.router)
app.include_router(integrations.router)


@app.middleware("http")
async def request_context(request: Request, call_next: RequestResponseEndpoint) -> Response:
    request_id = str(uuid4())
    request.state.request_id = request_id
    started = perf_counter()
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    getLogger("http.request").info("request completed", extra={
        "request_id": request_id,
        "method": request.method,
        "path": request.url.path,
        "status_code": response.status_code,
        "duration_ms": round((perf_counter() - started) * 1000, 2),
    })
    return response


@app.get("/health/live", tags=["health"])
def live() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/health/ready", tags=["health"])
def ready() -> dict[str, str]:
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        with Redis.from_url(settings.redis_url, socket_connect_timeout=1, socket_timeout=1) as redis_client:
            redis_client.ping()
    except (SQLAlchemyError, RedisError, OSError) as exc:
        raise HTTPException(status_code=503, detail="A required service is unavailable") from exc
    return {"status": "ready"}
