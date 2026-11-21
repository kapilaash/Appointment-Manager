
from pydantic import AnyHttpUrl, Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    ENVIRONMENT: str = "development"
    SECRET_KEY: str = "insecure_dev_secret_key_change_in_production_32bytes_min"
    SESSION_COOKIE_NAME: str = "chess_session_id"
    SESSION_MAX_AGE_SECONDS: int = 86400 * 7  # 7 days
    AUTH_PASSWORD_HASH_WORKERS: int = Field(default=4, ge=1, le=16)
    SENTRY_DSN: str = ""
    SENTRY_RELEASE: str = ""
    SENTRY_TRACES_SAMPLE_RATE: float = Field(default=0.05, ge=0, le=1)
    UPTIME_API_HEARTBEAT_URL: str = ""
    UPTIME_WORKER_HEARTBEAT_URL: str = ""
    UPTIME_HEARTBEAT_INTERVAL_SECONDS: int = Field(default=60, ge=15, le=3600)

    DATABASE_URL: str = "postgresql+asyncpg://chess_admin:chess_secure_pass_2025@localhost:5432/chess_academy"
    DB_POOL_SIZE: int = Field(default=5, ge=1, le=100)
    DB_MAX_OVERFLOW: int = Field(default=10, ge=0, le=100)
    DB_POOL_TIMEOUT_SECONDS: int = Field(default=30, ge=1, le=120)
    REDIS_URL: str = "redis://localhost:6379/0"
    REDIS_MAX_CONNECTIONS: int = Field(default=100, ge=10, le=10000)

    FRONTEND_URL: str = "http://localhost:5173"
    CORS_ORIGINS: list[str | AnyHttpUrl] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
    ]

    SMTP_HOST: str = "localhost"
    SMTP_PORT: int = 1025
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_USE_TLS: bool = False
    SMTP_USE_SSL: bool = False
    MAIL_FROM: str = "academy@chessplatform.com"
    MAIL_FROM_NAME: str = "Royal Chess Academy"

    MEILISEARCH_URL: str = "http://localhost:7700"
    MEILISEARCH_API_KEY: str = "local-development-only-change-before-deploying"

    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    GOOGLE_REDIRECT_URI: str = "http://localhost:5173/api/v1/integrations/google/callback"

    @field_validator("CORS_ORIGINS", mode="before")
    def assemble_cors_origins(cls, v: str | list[str]) -> list[str]:
        if isinstance(v, str) and not v.startswith("["):
            return [i.strip() for i in v.split(",")]
        elif isinstance(v, list):
            return [str(origin) for origin in v]
        return []

    @model_validator(mode="after")
    def validate_production_security(self) -> "Settings":
        if self.ENVIRONMENT.lower() == "production":
            known_sample_keys = {
                "insecure_dev_secret_key_change_in_production_32bytes_min",
                "super_secure_random_key_replace_this_with_64_characters_min",
            }
            if (
                len(self.SECRET_KEY.encode("utf-8")) < 32
                or self.SECRET_KEY in known_sample_keys
                or any(marker in self.SECRET_KEY.lower() for marker in ("replace", "change_me", "example"))
            ):
                raise ValueError("Production SECRET_KEY must be a unique random value of at least 32 bytes")
            if not self.CORS_ORIGINS or any(str(origin) == "*" for origin in self.CORS_ORIGINS):
                raise ValueError("Production CORS_ORIGINS must list the exact academy HTTPS origin")
            if any(not str(origin).startswith("https://") for origin in self.CORS_ORIGINS):
                raise ValueError("Every production CORS origin must use HTTPS")
            allowed_origins = {str(origin).rstrip("/") for origin in self.CORS_ORIGINS}
            if self.FRONTEND_URL.rstrip("/") not in allowed_origins:
                raise ValueError("Production FRONTEND_URL must match one of the allowed CORS origins")
        return self

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore"
    )


settings = Settings()
