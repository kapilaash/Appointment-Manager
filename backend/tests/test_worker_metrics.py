from prometheus_client import generate_latest

from app.workers.metrics import (
    WORKER_METRICS,
    record_worker_failure,
    set_worker_search_available,
)


def test_worker_metrics_report_failures_and_search_availability() -> None:
    record_worker_failure("metrics_test")
    set_worker_search_available(False)
    metrics = generate_latest(WORKER_METRICS).decode()

    assert 'worker_job_failures_total{job="metrics_test"} 1.0' in metrics
    assert "worker_search_dependency_available 0.0" in metrics

    set_worker_search_available(True)
