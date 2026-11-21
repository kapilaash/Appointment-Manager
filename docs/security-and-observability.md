# Security and observability operations

## What the monitoring stack sees

The API exports request counts and duration histograms with labels limited to HTTP method, matched route template, and response status. It does not use email addresses, IDs, raw URLs, query strings, or request bodies as metric labels. Responses include an `X-Request-ID`; the API accepts a short, character-filtered ID from the proxy and includes it in logs for 5xx or slow requests.

Primary Prometheus checks API metrics, the frontend, API liveness/readiness, Meilisearch, the ARQ worker, Loki, and Grafana Alloy. The worker exposes task failures, search dependency readiness, last successful cycle times, outbox depth by state, and oldest unprocessed event age on an internal-only metrics port. Alerts fire for stale worker cycles, events waiting over five minutes, permanently failed events, worker/search outages, API 5xx responses, log pipeline outages, Prometheus rule/config failures, and notification delivery failures. The single-5xx alert waits one minute before firing; expected 4xx responses do not page.

Meta-Prometheus independently scrapes the primary Prometheus, both Alertmanagers, Grafana, Blackbox Exporter, Loki, Alloy, the worker, and app probes. It routes its alerts through a separate Alertmanager. Both alert routers can send email and an optional HTTPS webhook. A small heartbeat sidecar polls the app and monitoring endpoints, exposes component health to both Prometheus servers, and only pings an external dead-man check when every endpoint responds. If the heartbeat sidecar or whole VM stops, the hosted uptime provider can alert on the missed ping. Each monitoring process has its own persisted state, although the in-host processes still share the host and Docker engine.

The Compose stack checks service reachability and app latency, but does not collect host CPU, memory, or disk metrics. Add host metrics from the hosting provider before using these dashboards to set production capacity limits. External uptime checks can detect a host outage; in-host Prometheus cannot report after the whole host is unavailable.

A local alert arrives in Mailpit. In production, set a monitored operations inbox, authenticated SMTP credentials, and TLS. `ALERT_WEBHOOK_URL` optionally adds an HTTPS webhook destination for an incident service. The generated Alertmanager file is stored in a private Docker volume and mounted read-only by Alertmanager. After changing alert settings, rerender and restart the alert routers:

```sh
docker compose --env-file .env.oci -f docker-compose.oci.yml -f docker-compose.observability.yml --profile observability up -d --build --force-recreate alertmanager-config alertmanager meta-alertmanager
```

The Prometheus, Grafana, and Alertmanager UIs bind to `127.0.0.1`; Loki and Alloy have no host-published ports. Use an SSH tunnel for remote administration and keep them off the public proxy. Alloy collects this Compose project's container logs through a Docker socket proxy with read-only container, event, and network metadata access. Loki retains logs for 14 days and accepts the Docker log backlog up to 30 days old during initial collection. Grafana Explore uses the provisioned Loki datasource; the operations dashboard also shows recent logs by `service_name`. Alerts report failed log writes and unhealthy health-check targets.

The frontend creates an `X-Request-ID` for API calls; the backend returns and logs that ID. If Sentry is configured, it tags backend issues with the request ID and propagates sampled browser traces through `/api` to FastAPI, database, and Redis spans. Frontend/backend Sentry events omit user identity, request bodies, cookies, CSRF values, and query strings. A known browser-extension async-listener message is filtered. Session replay is disabled. Without a Sentry DSN, the SDK stays inactive.

For readable production JavaScript stack traces, create frontend/backend Sentry projects and configure `VITE_SENTRY_DSN` and `SENTRY_DSN`, plus `SENTRY_ORG` and `SENTRY_PROJECT`. Store a scoped Sentry auth token in the ignored `.sentry-auth-token` file and set `SENTRY_AUTH_TOKEN_FILE` to that file in the deployment environment. The Vite build uses it as a BuildKit secret, uploads hidden source maps, then deletes them from the public bundle. The token is never a build argument or runtime variable. Set the frontend and backend trace sample rates to control sampling; the default is 5%.

For a path outside the VM, configure SMTP and/or an HTTPS Alertmanager webhook. Also create separate external heartbeat checks, then set `UPTIME_API_HEARTBEAT_URL`, `UPTIME_WORKER_HEARTBEAT_URL`, and `UPTIME_OBSERVABILITY_HEARTBEAT_URL` to their private ping URLs. The API sends a heartbeat only after database and Redis readiness pass; the worker pings only after its search dependency is ready and a scheduled cycle succeeds; the observability checker pings only while all monitored endpoints pass. Set checks to expect a ping every minute with a suitable grace period. Add a separate public HTTPS synthetic monitor for `https://PUBLIC_HOSTNAME/health/live`, with Caddy's access-gate credentials; heartbeat pings do not verify DNS, TLS, or the public edge. Keep provider URLs and webhook URLs in the protected deployment environment file.

Dependency maintenance runs in GitHub: weekly Dependabot PRs cover Python, npm, Docker images, and Actions; CI audits known vulnerabilities and fails when npm reports a deprecated package. Those checks can warn before an upgrade breaks the app, but they are not runtime Prometheus alerts. There are no third-party application APIs configured today whose `Deprecation` or `Sunset` response headers can be monitored.

## Login and connection capacity

Redis stores sessions and shared login-failure counters, so API replicas can remain stateless. Argon2 work runs in a bounded thread pool instead of blocking the async request loop. The queue accepts at most one additional password task per worker; excess requests receive a retryable 503 rather than growing memory without limit. Set `AUTH_PASSWORD_HASH_WORKERS` with the host's CPU and memory budget in mind; each process creates its own pool.

Database pool limits are configurable per process with `DB_POOL_SIZE` and `DB_MAX_OVERFLOW`. Budget connections using `API replicas × API processes × (pool size + overflow) + worker processes × (pool size + overflow)`, leaving room for migrations and administration. Redis client connections are capped by `REDIS_MAX_CONNECTIONS`. Increase replicas only after checking database connection limits, Redis capacity, and queue-worker throughput.

## Security and CI checklist

- Provide a unique production `SECRET_KEY` with at least 32 random bytes; the application refuses a short or known development value.
- Set a unique `SITE_ACCESS_USER` and generate `SITE_ACCESS_PASSWORD_HASH` with Caddy's interactive `caddy hash-password` command. The OCI Caddy edge requires this extra credential before returning the frontend or proxying API requests; users then sign in to their individual academy accounts as usual.
- Set `CORS_ORIGINS` to the exact HTTPS site origin. Keep database, Redis, search, SMTP, and Grafana credentials in a secret manager or ignored deployment environment file.
- Keep TLS termination at Caddy or another trusted edge. The application cookies become `Secure` in production, and Caddy sends HSTS only over the HTTPS site.
- Keep the backend on the private Compose network. A browser must download the frontend bundle, so the bundle must never contain private records or server secrets; the API checks session, CSRF, and user role before returning private data or performing actions.
- Use protected GitHub branches with review and required CI checks. Enable Dependabot alerts and secret scanning in repository settings. CI runs `pip-audit` and `npm audit`, fails on npm package deprecation warnings, and weekly Dependabot updates propose available package, image, and workflow-action upgrades. Publisher deprecation notices are dependency-maintenance signals, not runtime Prometheus alerts.
- Keep backups encrypted and test restore. Monitoring is not a backup or an incident-response plan.

The CI workflow runs backend/frontend tests, end-to-end checks, audits, and container/config validation. Its OCI deployment job runs only after all CI jobs pass on `main`, and only when the repository variable `OCI_DEPLOY_ENABLED` is `true`. Configure a protected GitHub `production` environment with required reviewers and add environment secrets `OCI_HOST`, `OCI_SSH_USER`, `OCI_SSH_PRIVATE_KEY`, and `OCI_KNOWN_HOSTS`. Set repository variable `OCI_DEPLOY_ROOT` to `/srv/chess-academy` (or another path under `/srv`). On the VM, keep `.env.oci` and `.sentry-auth-token` outside the release archive, and grant the SSH account access to that directory and Docker.

The deployment archives the tested commit, validates Compose, builds services, applies Alembic migrations, starts the release, and checks API/database/Redis readiness, frontend, worker search health, every independent heartbeat component, Loki, Alloy, Grafana, Prometheus, Alertmanager, and Caddy configuration. If health checks fail, it restores the previous application source/images. It does not reverse database migrations, so schema changes must remain backward compatible with the previous application release.
