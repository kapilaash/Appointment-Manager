"""Prometheus metrics exported by the separate ARQ worker process."""

import time
from typing import Any

from prometheus_client import CollectorRegistry, Counter, Gauge, start_http_server

WORKER_METRICS = CollectorRegistry()
WORKER_JOB_FAILURES = Counter(
    "worker_job_failures",
    "Background worker task failures, grouped by fixed task name.",
    ("task",),
    registry=WORKER_METRICS,
)
WORKER_SEARCH_AVAILABLE = Gauge(
    "worker_search_dependency_available",
    "Whether the worker can reach and update the search index.",
    registry=WORKER_METRICS,
)
WORKER_JOB_LAST_SUCCESS = Gauge(
    "worker_job_last_success_timestamp_seconds",
    "Unix timestamp of the last successful scheduled worker cycle.",
    ("task",),
    registry=WORKER_METRICS,
)
WORKER_OUTBOX_EVENTS = Gauge(
    "worker_outbox_events",
    "Number of outbox events by processing state and worker queue.",
    ("queue", "status"),
    registry=WORKER_METRICS,
)
WORKER_OUTBOX_OLDEST_UNPROCESSED = Gauge(
    "worker_outbox_oldest_unprocessed_timestamp_seconds",
    "Unix timestamp of the oldest pending or processing outbox event; zero when empty.",
    ("queue",),
    registry=WORKER_METRICS,
)
WORKER_UPTIME_HEARTBEAT_SUCCESS = Gauge(
    "worker_external_uptime_heartbeat_success",
    "Whether the worker's most recent external uptime heartbeat succeeded.",
    registry=WORKER_METRICS,
)
WORKER_UPTIME_HEARTBEAT_ENABLED = Gauge(
    "worker_external_uptime_heartbeat_enabled",
    "Whether an external uptime heartbeat URL is configured for the worker.",
    registry=WORKER_METRICS,
)


def record_worker_failure(task: str) -> None:
    WORKER_JOB_FAILURES.labels(task=task).inc()


def set_worker_search_available(available: bool) -> None:
    WORKER_SEARCH_AVAILABLE.set(1 if available else 0)


def record_worker_success(task: str) -> None:
    WORKER_JOB_LAST_SUCCESS.labels(task=task).set(time.time())


def set_outbox_count(queue: str, status: str, count: int) -> None:
    WORKER_OUTBOX_EVENTS.labels(queue=queue, status=status).set(count)


def set_oldest_unprocessed(queue: str, timestamp: float) -> None:
    WORKER_OUTBOX_OLDEST_UNPROCESSED.labels(queue=queue).set(timestamp)


def set_worker_uptime_heartbeat_success(success: bool) -> None:
    WORKER_UPTIME_HEARTBEAT_SUCCESS.set(1 if success else 0)


def set_worker_uptime_heartbeat_enabled(enabled: bool) -> None:
    WORKER_UPTIME_HEARTBEAT_ENABLED.set(1 if enabled else 0)


async def start_worker_metrics(ctx: dict[str, Any]) -> None:
    server, thread = start_http_server(8001, addr="0.0.0.0", registry=WORKER_METRICS)
    ctx["worker_metrics_server"] = server
    ctx["worker_metrics_thread"] = thread


async def stop_worker_metrics(ctx: dict[str, Any]) -> None:
    server = ctx.pop("worker_metrics_server", None)
    thread = ctx.pop("worker_metrics_thread", None)
    if server is not None:
        server.shutdown()
        server.server_close()
    if thread is not None:
        thread.join(timeout=2)
