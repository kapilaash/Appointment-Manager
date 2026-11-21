import json
import uuid
from typing import Any

import redis.asyncio as aioredis

from app.core.config import settings

_redis_client: aioredis.Redis | None = None


def get_redis_client() -> aioredis.Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = aioredis.from_url(
            settings.REDIS_URL,
            encoding="utf-8",
            decode_responses=True,
            max_connections=settings.REDIS_MAX_CONNECTIONS,
        )
    return _redis_client


async def close_redis_client() -> None:
    global _redis_client
    if _redis_client is not None:
        await _redis_client.aclose()
        _redis_client = None


class SessionStore:
    PREFIX = "sess:"
    CSRF_PREFIX = "csrf:"

    @classmethod
    async def create_session(cls, user_id: uuid.UUID, data: dict[str, Any]) -> tuple[str, str]:
        redis = get_redis_client()
        session_id = uuid.uuid4().hex + uuid.uuid4().hex
        csrf_token = uuid.uuid4().hex

        session_key = f"{cls.PREFIX}{session_id}"
        csrf_key = f"{cls.CSRF_PREFIX}{session_id}"

        payload = {"user_id": str(user_id), **data}
        await redis.setex(session_key, settings.SESSION_MAX_AGE_SECONDS, json.dumps(payload))
        await redis.setex(csrf_key, settings.SESSION_MAX_AGE_SECONDS, csrf_token)

        return session_id, csrf_token

    @classmethod
    async def get_session(cls, session_id: str) -> dict[str, Any] | None:
        redis = get_redis_client()
        data = await redis.get(f"{cls.PREFIX}{session_id}")
        if not data:
            return None
        return json.loads(data)

    @classmethod
    async def validate_csrf(cls, session_id: str, csrf_token: str) -> bool:
        redis = get_redis_client()
        expected = await redis.get(f"{cls.CSRF_PREFIX}{session_id}")
        return expected is not None and expected == csrf_token

    @classmethod
    async def destroy_session(cls, session_id: str) -> None:
        redis = get_redis_client()
        await redis.delete(f"{cls.PREFIX}{session_id}")
        await redis.delete(f"{cls.CSRF_PREFIX}{session_id}")

    @classmethod
    async def destroy_user_sessions(cls, user_id: uuid.UUID) -> None:
        """Revoke active sessions for a user after password reset or deactivation."""
        redis = get_redis_client()
        async for key in redis.scan_iter(match=f"{cls.PREFIX}*"):
            raw = await redis.get(key)
            if not raw:
                continue
            try:
                payload = json.loads(raw)
            except (TypeError, json.JSONDecodeError):
                continue
            if payload.get("user_id") == str(user_id):
                session_id = key.removeprefix(cls.PREFIX)
                await redis.delete(key, f"{cls.CSRF_PREFIX}{session_id}")
