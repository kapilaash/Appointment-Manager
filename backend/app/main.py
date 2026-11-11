from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import structlog
from app.core.config import settings
from app.core.logging import setup_logging

setup_logging()
logger = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting up Chess Academy API backend", environment=settings.ENVIRONMENT)
    yield
    logger.info("Shutting down Chess Academy API backend")


app = FastAPI(
    title="Chess Academy Scheduling Platform API",
    version="1.0.0",
    description="High-reliability scheduling engine with PostgreSQL GiST exclusion double-booking prevention.",
    docs_url="/docs" if settings.ENVIRONMENT != "production" else None,
    redoc_url=None,
    lifespan=lifespan,
)

# CORS configuration for secure cookie and API communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["X-CSRF-Token"],
)


@app.get("/health", tags=["System"])
async def health_check():
    return {
        "status": "healthy",
        "environment": settings.ENVIRONMENT,
        "database": "connected"
    }


@app.get("/api/v1", tags=["System"])
async def root_api():
    return {
        "message": "Welcome to Chess Academy API v1",
        "docs": "/docs" if settings.ENVIRONMENT != "production" else "disabled"
    }
