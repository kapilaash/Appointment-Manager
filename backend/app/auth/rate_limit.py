"""Small Redis-backed login failure counters shared by API workers."""

import hashlib
import hmac
from dataclasses import dataclass
from typing import Any

from app.core.config import settings

LOGIN_FAILURE_WINDOW_SECONDS = 15 * 60
LOGIN_IP_FAILURE_LIMIT = 20
LOGIN_EMAIL_FAILURE_LIMIT = 8


@dataclass(frozen=True)
class LoginFailureState:
    ip_failures: int
    email_failures: int
    ip_retry_after: int
    email_retry_after: int

    @property
    def ip_limited(self) -> bool:
        return self.ip_failures >= LOGIN_IP_FAILURE_LIMIT

    @property
    def email_limited(self) -> bool:
        return self.email_failures >= LOGIN_EMAIL_FAILURE_LIMIT


def _key(scope: str, value: str) -> str:
    digest = hmac.new(
        settings.SECRET_KEY.encode(), value.encode(), hashlib.sha256
    ).hexdigest()
    return f"login-failure:{scope}:{digest}"


def _integer(value: Any, default: int = 0) -> int:
    try:
        return int(value) if value is not None else default
    except (TypeError, ValueError):
        return default


async def get_login_failure_state(redis: Any, client_ip: str, email: str) -> LoginFailureState:
    ip_key = _key("ip", client_ip)
    email_key = _key("email", email.strip().lower())
    pipeline = redis.pipeline(transaction=True)
    pipeline.get(ip_key)
    pipeline.get(email_key)
    pipeline.ttl(ip_key)
    pipeline.ttl(email_key)
    results = await pipeline.execute()
    return LoginFailureState(
        ip_failures=_integer(results[0]),
        email_failures=_integer(results[1]),
        ip_retry_after=max(1, _integer(results[2], 1)),
        email_retry_after=max(1, _integer(results[3], 1)),
    )


async def record_login_failure(redis: Any, client_ip: str, email: str) -> LoginFailureState:
    ip_key = _key("ip", client_ip)
    email_key = _key("email", email.strip().lower())
    pipeline = redis.pipeline(transaction=True)
    pipeline.incr(ip_key)
    pipeline.expire(ip_key, LOGIN_FAILURE_WINDOW_SECONDS, nx=True)
    pipeline.incr(email_key)
    pipeline.expire(email_key, LOGIN_FAILURE_WINDOW_SECONDS, nx=True)
    await pipeline.execute()
    return await get_login_failure_state(redis, client_ip, email)


async def clear_login_failures(redis: Any, client_ip: str, email: str) -> None:
    await redis.delete(_key("ip", client_ip), _key("email", email.strip().lower()))
