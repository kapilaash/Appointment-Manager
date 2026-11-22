"""Probe the app and observability stack, and optionally ping an external dead-man check."""

import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Lock, Thread
from urllib.error import URLError
from urllib.request import Request, urlopen

INTERVAL_SECONDS = max(10, int(os.environ.get("UPTIME_HEARTBEAT_INTERVAL_SECONDS", "60")))
EXTERNAL_HEARTBEAT_URL = os.environ.get("UPTIME_OBSERVABILITY_HEARTBEAT_URL", "").strip()
TARGETS = {
    "api": "http://backend:8000/health/ready",
    "worker": "http://worker:8001/metrics",
    "frontend": os.environ.get("FRONTEND_INTERNAL_HEALTH_URL", "http://frontend:5173/"),
    "search": "http://meilisearch:7700/health",
    "prometheus": "http://prometheus:9090/-/healthy",
    "meta_prometheus": "http://meta-prometheus:9090/-/healthy",
    "alertmanager": "http://alertmanager:9093/-/healthy",
    "meta_alertmanager": "http://meta-alertmanager:9093/-/healthy",
    "grafana": "http://grafana:3000/api/health",
    "loki": "http://loki:3100/ready",
    "alloy": "http://alloy:12345/metrics",
    "blackbox_exporter": "http://blackbox-exporter:9115/metrics",
}

logger = logging.getLogger("observability.heartbeat")
metrics_lock = Lock()
component_health = {component: 0 for component in TARGETS}
external_heartbeat_success: int | None = 0 if EXTERNAL_HEARTBEAT_URL else None


class MetricsHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path != "/metrics":
            self.send_error(404)
            return
        with metrics_lock:
            current_components = dict(component_health)
            heartbeat_success = external_heartbeat_success
        lines = [
            "# HELP observability_component_healthy Whether an application or observability endpoint passed its latest HTTP health check.",
            "# TYPE observability_component_healthy gauge",
        ]
        lines.extend(
            f'observability_component_healthy{{component="{component}"}} {value}'
            for component, value in current_components.items()
        )
        if heartbeat_success is not None:
            lines.extend(
                [
                    "# HELP observability_external_uptime_heartbeat_success Whether the latest external observability dead-man heartbeat was delivered.",
                    "# TYPE observability_external_uptime_heartbeat_success gauge",
                    f"observability_external_uptime_heartbeat_success {heartbeat_success}",
                ]
            )
        body = ("\n".join(lines) + "\n").encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, _format: str, *_args: object) -> None:
        return


def _healthy(_name: str, url: str) -> bool:
    try:
        request = Request(url, headers={"User-Agent": "academy-observability-health/1.0"})
        with urlopen(request, timeout=4) as response:
            return 200 <= response.status < 400
    except (OSError, URLError, TimeoutError):
        return False


def _send_external_heartbeat() -> bool:
    try:
        request = Request(
            EXTERNAL_HEARTBEAT_URL,
            headers={"User-Agent": "academy-observability-health/1.0"},
        )
        with urlopen(request, timeout=5) as response:
            return 200 <= response.status < 400
    except (OSError, URLError, TimeoutError):
        return False


def main() -> None:
    global external_heartbeat_success
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
    server = ThreadingHTTPServer(("0.0.0.0", 9100), MetricsHandler)
    server.daemon_threads = True
    Thread(target=server.serve_forever, daemon=True).start()

    with ThreadPoolExecutor(max_workers=len(TARGETS)) as pool:
        while True:
            started_at = time.monotonic()
            checks = {
                component: pool.submit(_healthy, component, url)
                for component, url in TARGETS.items()
            }
            results = {component: future.result() for component, future in checks.items()}
            with metrics_lock:
                component_health.update(
                    {component: int(healthy) for component, healthy in results.items()}
                )

            all_healthy = all(results.values())
            if EXTERNAL_HEARTBEAT_URL and all_healthy:
                delivered = _send_external_heartbeat()
                with metrics_lock:
                    external_heartbeat_success = int(delivered)
                if not delivered:
                    logger.warning("external_observability_heartbeat_failed")

            failed = [component for component, healthy in results.items() if not healthy]
            if failed:
                logger.warning("observability_health_check_failed components=%s", ",".join(failed))

            elapsed = time.monotonic() - started_at
            time.sleep(max(1, INTERVAL_SECONDS - elapsed))


if __name__ == "__main__":
    main()
