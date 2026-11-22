"""Optional Sentry error reporting with request payloads and identity data removed."""

from contextlib import nullcontext
from typing import TYPE_CHECKING, Any
from urllib.parse import urlsplit, urlunsplit

from app.core.config import settings

if TYPE_CHECKING:  # Sentry is imported lazily at runtime, only when a DSN is configured.
    from sentry_sdk.types import Event


def _scrub_event(event: "Event", _hint: dict[str, Any]) -> "Event":
    event.pop("user", None)
    request = event.get("request")
    if isinstance(request, dict):
        for key in ("data", "cookies", "query_string", "env"):
            request.pop(key, None)
        url = request.get("url")
        if isinstance(url, str):
            parsed = urlsplit(url)
            request["url"] = urlunsplit((parsed.scheme, parsed.netloc, "/", "", ""))
        headers = request.get("headers")
        if isinstance(headers, dict):
            for key in tuple(headers):
                if key.lower() in {"authorization", "cookie", "set-cookie", "x-csrf-token"}:
                    headers.pop(key, None)
    return event


def configure_error_tracking() -> None:
    if not settings.SENTRY_DSN:
        return
    import sentry_sdk

    sentry_sdk.init(
        dsn=settings.SENTRY_DSN,
        environment=settings.ENVIRONMENT,
        release=settings.SENTRY_RELEASE or None,
        send_default_pii=False,
        include_local_variables=False,
        traces_sample_rate=settings.SENTRY_TRACES_SAMPLE_RATE,
        before_send=_scrub_event,
        before_send_transaction=_scrub_event,
    )


def set_request_id(request_id: str) -> None:
    if settings.SENTRY_DSN:
        import sentry_sdk

        sentry_sdk.set_tag("request_id", request_id)


def capture_exception(error: BaseException) -> None:
    if settings.SENTRY_DSN:
        import sentry_sdk

        sentry_sdk.capture_exception(error)


def worker_span(name: str) -> Any:
    if not settings.SENTRY_DSN:
        return nullcontext(None)
    import sentry_sdk

    return sentry_sdk.start_span(op="queue.process", name=name)
