# Thirumal Chess Academy

The active application provides staff sign-in, administrator-managed coach accounts, coach profiles and individual weekly availability, date-specific exceptions, and an administrator booking flow. Admins can book a coach with student or parent contact details; a durable outbox queues notifications and keeps appointment search in Meilisearch in sync with PostgreSQL. Coaches edit their own profile and meeting link directly. Every coach change that affects bookings (weekly hours, time off, extra hours, time zone/country, and requests to cancel or reschedule a demo) becomes a **change request** that takes effect only after an administrator approves it on **Approvals**; all active admins are emailed when a request arrives and the coach is emailed the decision. Admins' own changes apply immediately. **Team availability** shows every coach's free and booked time for a day in any time zone (typically the client's), and a free block opens a pre-filled booking. Existing bookings are preserved when schedules change.

Appearance themes (Studio, Classic Chess, Black & White, and Match my device) are saved to each account, so they follow the user across devices. Theme changes cross-fade slowly (700 ms, via the View Transitions API) and respect the reduced-motion setting; the saved theme is applied before the first paint, so there is no light flash on load. Role-specific Help & guides are included.

## Run locally with Docker

Requirements: Docker Desktop with Compose and network access to pull the pinned images and package dependencies.

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
docker compose up -d --build
```

The local backend applies Alembic migrations before it starts. PostgreSQL and Redis readiness are checked before the API is marked healthy; the worker starts only after that.

If this database has no administrator yet, create the first one interactively:

```powershell
docker compose exec -it backend python -m app.cli seed-admin --email YOUR_ADMIN_EMAIL
```

`seed-admin` creates an account when the email is new. If that email already exists, it resets that account's password and assigns the admin role, so use it only when that is intended. Do not use it to create coach accounts.

Open:

- Frontend: <http://localhost:5173>
- API documentation: <http://localhost:5173/docs> (proxied to FastAPI by Vite)
- Mailpit inbox: <http://localhost:8025>

Sign in as the administrator and open **Coach accounts** to invite coaches and manage their accounts. Invitation and one-time password-reset links are emailed to the coach and also shown once to the administrator for private sharing. Passwords are hashed and never visible to admins. Coaches use **My profile** and **Availability** to maintain their own details and schedule. Admins use **Availability** to inspect coach schedules and **Book a demo** to make a booking with client contact details.

Mailpit is the local SMTP catcher: invitation, password-reset, and booking messages appear in its inbox at <http://localhost:8025> without being delivered to real email accounts. The OCI production example is configured for Gmail SMTP, so production sends real messages while local development remains safely captured by Mailpit. See [the free Gmail setup and limits](ops/oci/README.md#configure). Coaches can save a default HTTPS meeting link; an admin can override or clear it for each booking. The app sends and displays the chosen link, but does not create meetings through Google Meet or Zoom APIs.

## Observability

The optional observability profile runs Prometheus, a separate meta-Prometheus, Grafana, two Alertmanagers, and a Blackbox Exporter. It monitors API request rate, error rate and latency, app readiness, frontend availability, monitoring service health, and alert delivery failures. The two Prometheus instances watch each other and the alert routers; both use separate persistent data volumes.

Start it locally with Mailpit as the alert receiver:

```powershell
docker compose -f docker-compose.yml -f docker-compose.observability.yml --profile observability up --build -d
```

Open Grafana at <http://localhost:3000> with the `GRAFANA_ADMIN_USER` and `GRAFANA_ADMIN_PASSWORD` from `.env`. Prometheus is at <http://localhost:9090>, meta-Prometheus at <http://localhost:9091>, and Alertmanager at <http://localhost:9093> and <http://localhost:9094>. All monitoring ports bind to localhost and are not published publicly. Local alert emails appear in Mailpit at <http://localhost:8025>.

For OCI deployment, set unique Grafana credentials and a real `ALERT_EMAIL_TO`/SMTP configuration in `.env.oci`, then include `docker-compose.observability.yml` with `docker-compose.oci.yml`. Recreate `alertmanager-config` after changing SMTP or webhook settings so its private shared config is rendered again. Alert rules and dashboard files are provisioned from the repository. Meta-Prometheus checks the primary monitoring stack; an independent heartbeat sidecar can ping an external dead-man check only while the app and monitoring stack respond. Configure `UPTIME_OBSERVABILITY_HEARTBEAT_URL` and an external synthetic check for the public HTTPS URL so an external service can notify you if the host or its network fails.

The meta stack checks the metrics, dashboard, exporters, and alert routers, while the primary stack probes the frontend and API readiness, including database and Redis connectivity. Meilisearch's health endpoint is probed separately. This gives service-level failure signals; it does not replace backups or an external check from outside the Docker host.

## Security and deployment workflow

The workspace pages and API data require a valid account session; mutating API requests also require the CSRF token, and login failures are rate limited. Production cookies are `HttpOnly`, `Secure`, and `SameSite=Lax`; production startup rejects a short/default signing secret or non-HTTPS CORS origins. The API runs as a non-root container user, the production backend has no published host port, and the standalone production frontend binds to localhost behind a trusted TLS proxy. OCI monitoring and database ports are likewise local-only.

The compiled frontend must be sent to a browser, so its HTML, JavaScript, and styles can be downloaded by any visitor. Those files contain no private records or server credentials. Private student, coach, appointment, and administrative data must come from authenticated, role-checked API routes. Do not put secrets or personal records in frontend environment variables or source files.

GitHub Actions runs backend checks, browser tests, frontend checks, and dependency security audits on pull requests and pushes to `main`. Dependabot proposes weekly updates for Python, npm, Docker images, and Actions. Protect `main` with required CI checks and review, keep repository secrets out of code, and enable GitHub dependency alerts/secret scanning in repository settings. The workflow validates changes; deployment remains a manual release step until the hosting target and deployment credentials are configured.

For the precise account lifecycle and security behavior, see [docs/coach-access.md](docs/coach-access.md).

Stop services with **Ctrl+C**. `docker compose down` preserves the local database volume. `docker compose down -v` deletes it.

## Local setup without Docker

Run PostgreSQL, Redis, Meilisearch, and Mailpit separately. Set `MEILISEARCH_URL` and `MEILISEARCH_API_KEY` for the backend and worker. From the repository root:

```powershell
py -3.12 -m venv backend/.venv
backend/.venv/Scripts/Activate.ps1
python -m pip install -e "backend[dev]"
```

Set `DATABASE_URL`, `REDIS_URL`, `SMTP_HOST=localhost`, and `SMTP_PORT=1025` in your shell, then run these in separate terminals:

```powershell
cd backend
alembic upgrade head
python -m app.cli seed-admin --email YOUR_ADMIN_EMAIL
uvicorn app.main:app --reload --port 8000
```

```powershell
cd backend
python -m arq app.workers.main.WorkerSettings
```

```powershell
cd frontend
npm ci
npm run dev
```

Backend dependencies are declared in `backend/pyproject.toml`. Frontend dependencies are recorded in `frontend/package-lock.json`; Docker uses `npm ci` for reproducible development and production builds.

For frontend commands run directly on Windows, use Node.js 22.22.2 or later to satisfy the locked test-tool engine requirements. The Docker frontend uses the current Node 22 image.

## Email and meeting details

In local Docker, the API sends coach invitation and password-reset emails, and the ARQ worker sends booking emails to Mailpit. Mailpit accepts SMTP and keeps them out of real inboxes; open <http://localhost:8025> to inspect messages. Coaches can request their own reset link from the sign-in page. Production Compose reads SMTP settings from the environment; the OCI example uses a dedicated Gmail account with `smtp.gmail.com`, port `587`, STARTTLS, a Google App Password, and that same address as `MAIL_FROM`. Configure the credentials only in the ignored server-side `.env.oci` file. Google requires 2-Step Verification for App Passwords, describes them as less secure than OAuth sign-in, and may revoke them when the account password changes. Keep this account for low-volume transactional notifications; a standard Gmail account has a published limit of over 500 messages per day or over 500 recipients in one message. See [Google's SMTP settings](https://support.google.com/mail/answer/7104828), [App Password guidance](https://support.google.com/accounts/answer/185833), and [sending limits](https://support.google.com/mail/answer/22839). For a commercial sender identity or higher volume, use a domain-based mail provider with SPF, DKIM, and DMARC rather than a personal Gmail address.

Appointment search runs through the backend and Meilisearch. The worker creates the index, imports existing appointments on startup, and processes transactional outbox events for later changes. Meilisearch is available only inside the local Compose network; keep its master key on the server.

Meeting URLs must use HTTPS. The coach's default is copied onto new bookings unless an admin supplies a one-off URL or explicitly clears the field. The app does not provision a provider meeting or calendar event automatically.

## Tests and checks

```powershell
cd backend
python -m compileall -q app alembic tests
ruff check app alembic tests
mypy app
pytest
```

PostgreSQL-backed tests (approval workflow, team availability, data retention, booking concurrency) use only a dedicated database whose name ends in `_test`; set `TEST_DATABASE_URL` accordingly, for example `postgresql+psycopg://USER:PASSWORD@127.0.0.1:5432/chess_academy_test`. Use `127.0.0.1` rather than `localhost` on Windows. The tests refuse other database names.

```powershell
cd frontend
npm run typecheck
npm run lint
npm run test
npm run build
npm run test:e2e
```

Screenshot and accessibility checks run in the official Playwright Linux image so they match CI exactly (Docker required): `npm run test:visual` compares key pages in every theme against approved images and runs axe WCAG 2.1 AA scans; after an intentional visual change, review and approve with `npm run test:visual:update`. Colour token names are documented in [docs/design-tokens.md](docs/design-tokens.md).

Against the Docker stack, run `PLAYWRIGHT_BASE_URL=http://127.0.0.1:5173 E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... npm run test:e2e`. The Playwright workflow expects the development services, migrations, an administrator created with `seed-admin`, and the ARQ notification worker. GitHub Actions configures these services and runs the full browser scenario. CI also audits installed Python dependencies and the npm dependency tree; Dependabot checks Python, npm, Docker images, and GitHub Actions updates weekly.

## Production outline

Use `docker-compose.production.yml` with environment variables supplied by a secret manager. It expects managed PostgreSQL and Redis; it does not expose either database publicly. Run migrations as a release step before deploying the API:

```sh
docker compose --env-file .env.production -f docker-compose.production.yml run --rm backend alembic upgrade head
docker compose --env-file .env.production -f docker-compose.production.yml up --build -d
```

Place a trusted HTTPS reverse proxy or load balancer in front of the frontend service and point the academy domain to it. The frontend Nginx container serves the SPA and proxies `/api/` to FastAPI. Set the exact public origin in `CORS_ORIGINS` and `FRONTEND_URL`. Use unique secrets, strong database credentials, encrypted database backups, and a documented restore drill. Never use the local sample secrets in production.

Before production, choose a student-data retention period with the academy, verify SMTP sender authorization, and test backup restoration. An administrator can permanently delete a student after any future confirmed demos are cancelled or rescheduled. Past bookings remain as redacted records with no student row or contact details.

## Architecture and status

See [docs/architecture.md](docs/architecture.md) for module boundaries, availability and concurrency decisions, status transitions, and known external setup. The API is versioned under `/api/v1`; health endpoints are `/health/live` and `/health/ready`.

## Accounts and passwords

- Passwords are stored only as Argon2 hashes; nobody, including administrators, can read them. Use a password manager to remember them.
- New passwords need at least 12 characters and must not be on the built-in list of commonly leaked passwords or contain your email name (NIST SP 800-63B guidance; no forced expiry).
- **Change password:** My profile → Password & security. Other devices are signed out and an email confirms the change.
- **Forgot password (every role):** "Forgot your password?" on the sign-in page emails a one-time link valid for 30 minutes (Mailpit locally, Gmail in production). The reply is identical whether or not the email exists. The username is always the email address.
- **Two-step sign-in (recommended for admins):** My profile → Password & security. Works with any authenticator app; ten single-use recovery codes cover a lost phone. Secrets are encrypted with a key derived from `SECRET_KEY` (rotating it requires users to set up two-step sign-in again).
- **Emergency access** when email is down or every admin is locked out, run on the server:

  ```powershell
  docker compose exec -it backend python -m app.cli reset-password --email someone@example.com
  docker compose exec -it backend python -m app.cli reset-mfa --email someone@example.com
  ```

## Self-maintenance

- **Data retention.** The worker runs a daily purge (03:17 UTC) that deletes finished background-job rows after `OUTBOX_RETENTION_DAYS` (30), failed ones after `FAILED_OUTBOX_RETENTION_DAYS` (90), and expired invitation/reset links after `ACCOUNT_TOKEN_RETENTION_DAYS` (30). Booking, notification and approval history are kept. Failures surface through the existing worker-failure alert.
- **New releases.** Browser tabs opened before a deploy reload once automatically if they request a code file the new release removed.
- **Network drops.** An offline banner explains why saving is paused, and data refreshes on its own when the connection returns.
- **Error tracking.** Sentry's browser code is downloaded only when `VITE_SENTRY_DSN` is set.
- **Docker on Windows/macOS.** `VITE_USE_POLLING=true` (set in `docker-compose.yml`) makes the Vite dev server notice file edits through bind mounts.
