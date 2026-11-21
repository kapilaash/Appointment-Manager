"""Low-cardinality request metrics and request-ID propagation for the API."""

import re
import time
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

import structlog
from prometheus_client import Counter, Gauge, Histogram

REQUESTS = Counter(
    "app_http_requests_total",
    "Completed HTTP requests handled by the API.",
    ("method", "route", "status"),
)
REQUEST_DURATION = Histogram(
    "app_http_request_duration_seconds",
    "HTTP request duration in seconds.",
    ("method", "route"),
    buckets=(0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10),
)
API_UPTIME_HEARTBEAT_SUCCESS = Gauge(
    "app_external_uptime_heartbeat_success",
    "Whether the API's most recent external uptime heartbeat succeeded.",
)
API_UPTIME_HEARTBEAT_ENABLED = Gauge(
    "app_external_uptime_heartbeat_enabled",
    "Whether an external uptime heartbeat URL is configured for the API.",
)

_REQUEST_ID_PATTERN = re.compile(rb"[A-Za-z0-9._-]{1,64}\Z")
_logger = structlog.get_logger(__name__)


class RequestMetricsMiddleware:
    """Record one sample per request without using user input as a metric label."""

    def __init__(self, app: Callable[..., Awaitable[None]]) -> None:
        self.app = app

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope.get("type") != "http" or scope.get("path", "").startswith("/metrics"):
            await self.app(scope, receive, send)
            return

        request_headers = dict(scope.get("headers", []))
        supplied_id = request_headers.get(b"x-request-id", b"")
        request_id = (
            supplied_id.decode("ascii")
            if _REQUEST_ID_PATTERN.fullmatch(supplied_id)
            else uuid.uuid4().hex
        )
        from app.observability.error_tracking import set_request_id

        set_request_id(request_id)
        method = scope.get("method", "UNKNOWN")
        started_at = time.perf_counter()
        status_code = 500

        async def send_with_request_id(message: dict[str, Any]) -> None:
            nonlocal status_code
            if message.get("type") == "http.response.start":
                status_code = int(message["status"])
                response_headers = [
                    (name, value)
                    for name, value in message.get("headers", [])
                    if name.lower() != b"x-request-id"
                ]
                response_headers.append((b"x-request-id", request_id.encode("ascii")))
                message = {**message, "headers": response_headers}
            await send(message)

        try:
            await self.app(scope, receive, send_with_request_id)
        finally:
            duration = time.perf_counter() - started_at
            route_object = scope.get("route")
            route = getattr(route_object, "path", "unmatched")
            REQUESTS.labels(method=method, route=route, status=str(status_code)).inc()
            REQUEST_DURATION.labels(method=method, route=route).observe(duration)
            if status_code >= 500 or duration >= 2:
                _logger.warning(
                    "http_request_error_or_slow",
                    request_id=request_id,
                    method=method,
                    route=route,
                    status_code=status_code,
                    duration_ms=round(duration * 1000, 1),
                )
