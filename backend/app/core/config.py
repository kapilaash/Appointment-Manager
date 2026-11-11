from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_env: str = "development"
    log_level: str = "INFO"
    database_url: str = "postgresql+psycopg://chess_academy:local_development_only@localhost:5432/chess_academy"
    redis_url: str = "redis://localhost:6379/0"
    celery_broker_url: str = "redis://localhost:6379/1"
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:5173"])
    session_cookie_secure: bool = False
    session_ttl_hours: int = 24
    csrf_cookie_name: str = "chess_csrf"
    session_cookie_name: str = "chess_session"
    meeting_provider: str = "mock"
    email_provider: str = "smtp"
    smtp_host: str = "localhost"
    smtp_port: int = 1025
    smtp_from: str = "academy@example.test"
    google_client_id: str | None = None
    google_client_secret: str | None = None
    google_redirect_uri: str = "http://localhost:5173/api/v1/integrations/google/callback"
    encryption_key: str | None = None
    frontend_url: str = "http://localhost:5173"
    csrf_secret: str = "local-only-change-this-secret-before-deploying-000000000000"
    student_retention_days: int = 730

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()
