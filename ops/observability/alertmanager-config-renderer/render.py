"""Render Alertmanager's SMTP settings into a private shared config volume."""

import json
import os
from pathlib import Path
from urllib.parse import urlsplit


def required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise SystemExit(f"{name} is required when observability is enabled")
    return value


def main() -> None:
    output_dir = Path("/run/alertmanager-config")
    output_dir.mkdir(parents=True, exist_ok=True)
    config = f"""global:
  smtp_smarthost: {json.dumps(required('ALERT_SMTP_HOST') + ':' + required('ALERT_SMTP_PORT'))}
  smtp_from: {json.dumps(required('ALERT_SMTP_FROM'))}
  smtp_auth_username: {json.dumps(os.environ.get('ALERT_SMTP_USERNAME', ''))}
  smtp_auth_password: {json.dumps(os.environ.get('ALERT_SMTP_PASSWORD', ''))}
  smtp_require_tls: {str(os.environ.get('ALERT_SMTP_REQUIRE_TLS', 'false').lower() == 'true').lower()}

route:
  receiver: academy-email
  group_by: [alertname, environment]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h

receivers:
  - name: academy-email
    email_configs:
      - to: {json.dumps(required('ALERT_EMAIL_TO'))}
        send_resolved: true
"""
    webhook_url = os.environ.get("ALERT_WEBHOOK_URL", "").strip()
    if webhook_url:
        parsed = urlsplit(webhook_url)
        if parsed.scheme != "https" or not parsed.netloc:
            raise SystemExit("ALERT_WEBHOOK_URL must be an HTTPS URL")
        config += f"""    webhook_configs:
      - url: {json.dumps(webhook_url)}
        send_resolved: true
"""
    destination = output_dir / "alertmanager.yml"
    temporary = output_dir / "alertmanager.yml.tmp"
    temporary.write_text(config, encoding="utf-8")
    temporary.chmod(0o644)
    temporary.replace(destination)


if __name__ == "__main__":
    main()
