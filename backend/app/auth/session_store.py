import json
import uuid
from typing import Any, Dict, Optional
import redis.asyncio as aioredis
from app.core.config import settings

_redis_client: Optional[aioredis.Redis] = None


def get_redis_client() -> aioredis.Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = aioredis.from_url(settings.REDIS_URL, encoding="utf-8", decode_responses=True)
    return _redis_client


class SessionStore:
    PREFIX = "sess:"
    CSRF_PREFIX = "csrf:"

    @classmethod
    async def create_session(cls, user_id: uuid.UUID, data: Dict[str, Any]) -> tuple[str, str]:
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
    async def get_session(cls, session_id: str) -> Optional[Dict[str, Any]]:
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
