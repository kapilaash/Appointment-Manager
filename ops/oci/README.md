# OCI free-tier deployment

This stack is for an OCI Compute VM running the application and its PostgreSQL, Redis, and Meilisearch dependencies together. It is separate from the development Compose stack and does not expose the database, Redis, or Meilisearch ports publicly. PostgreSQL is bound to the VM's loopback address so DBeaver can reach it through SSH forwarding.

The OCI database is production-only (`chess_academy_prod`). Automated tests already use disposable `chess_academy_test` databases in GitHub Actions; do not point tests or development tools at the production URL. A separate staging environment can be added later if you need to test release candidates against production-like infrastructure.

## Requirements

- An OCI VM that is within the tenancy's Always Free limits.
- Docker Engine and the Docker Compose plugin on the VM.
- A DNS hostname pointing to the VM's public IP. Caddy obtains and renews HTTPS certificates, so inbound TCP ports 80 and 443 must reach the VM.
- SSH access to the VM. Restrict OCI ingress for TCP 22 to your own IP address where practical.
- A dedicated Gmail account for low-volume transactional mail. Port 587 with STARTTLS is the default in this stack.

The free-tier VM is best-effort infrastructure. Keep database backups outside the VM and periodically verify that a backup can be restored.

## Configure

Copy `.env.oci.example` to `.env.oci` on the VM and fill in the hostname, Gmail address, Google App Password, sender address, and secrets. Generate distinct random passwords and keys; hexadecimal values from `openssl rand -hex 32` work with the connection URLs used here. Protect the file with `chmod 600 .env.oci` and do not commit it.

For Gmail, create a dedicated academy account instead of using your everyday personal Gmail account. Turn on 2-Step Verification for that Google Account, then create an App Password from **Google Account > Security > App passwords**. Put the full Gmail address in both `SMTP_USER` and `MAIL_FROM`, and the generated 16-character App Password in `SMTP_PASSWORD` (omit any spaces used to display it). Do not use the account's normal password. Google may not offer App Passwords for accounts using Advanced Protection or some organization-managed security policies. App Passwords are a practical SMTP option for this single-purpose sender, although Google recommends "Sign in with Google" where an app supports it; revoke the App Password if it is no longer needed.

The production stack sends real messages to the coach, booking contact, and admin who created the booking. Development stays on Mailpit and does not send to real inboxes. A standard personal Gmail account is suitable for modest appointment and account notifications, not newsletters or bulk email; Google documents a limit of more than 500 messages per day or more than 500 recipients in one message, and may temporarily restrict sending. Gmail SMTP uses TLS on port 587. See [Google's Gmail SMTP settings](https://support.google.com/mail/answer/7104828), [App Password guidance](https://support.google.com/accounts/answer/185833), and [Gmail sending limits](https://support.google.com/mail/answer/22839).

The PostgreSQL bootstrap user is reserved for administration. The app uses a separate role with schema creation permission for Alembic migrations. `POSTGRES_READONLY_USER` is a read-only login intended for DBeaver.

## Start or update

For manual setup, from the project directory on the VM, build images, apply migrations, and start production and observability services:

```sh
docker compose --env-file .env.oci -f docker-compose.oci.yml -f docker-compose.observability.yml --profile observability config --quiet
docker compose --env-file .env.oci -f docker-compose.oci.yml -f docker-compose.observability.yml --profile observability build
docker compose --env-file .env.oci -f docker-compose.oci.yml -f docker-compose.observability.yml --profile observability run --rm backend alembic upgrade head
docker compose --env-file .env.oci -f docker-compose.oci.yml -f docker-compose.observability.yml --profile observability up -d
```

Only the Caddy service publishes public web ports. PostgreSQL is available on `127.0.0.1:5432` on the VM and should not be opened in the OCI security list.

## GitHub Actions deployment

The `deploy-oci` job runs after the full CI workflow succeeds on `main` when repository variable `OCI_DEPLOY_ENABLED` is `true`. Create a protected GitHub Environment named `production`, require a reviewer, add environment secrets `OCI_HOST`, `OCI_SSH_USER`, `OCI_SSH_PRIVATE_KEY`, and `OCI_KNOWN_HOSTS`, and set `OCI_DEPLOY_ROOT` to `/srv/chess-academy`. The deployment user needs Docker access and write access to the deploy root. Copy `.env.oci` to `/srv/chess-academy/.env.oci` on the VM before enabling deployment.

The workflow uploads a commit archive over verified SSH. `ops/oci/deploy-release.sh` builds the release, applies migrations, starts services, checks health, and rebuilds the previous application release if checks fail. Database migrations are not downgraded during rollback; keep schema changes compatible with the previous application release.

## External alerting and browser diagnostics

Set `ALERT_SMTP_*` and `ALERT_EMAIL_TO` for off-host email. `ALERT_WEBHOOK_URL` can add an HTTPS webhook receiver. For full-host and observability outage detection, create separate external heartbeat checks and set `UPTIME_API_HEARTBEAT_URL`, `UPTIME_WORKER_HEARTBEAT_URL`, and `UPTIME_OBSERVABILITY_HEARTBEAT_URL` in `.env.oci`. The observability heartbeat pings only while the app, monitoring services, log collector, and log store are healthy. Use a one-minute schedule with a suitable grace period. Separately configure an HTTPS monitor for `https://PUBLIC_HOSTNAME/health/live` with the site's Caddy access credentials.

To send browser/backend errors and traces to Sentry, set `VITE_SENTRY_DSN`, `SENTRY_DSN`, and sample rates. For readable minified browser stack traces, set `SENTRY_ORG` and `SENTRY_PROJECT`, create the ignored `.sentry-auth-token` file with a scoped auth token, and set `SENTRY_AUTH_TOKEN_FILE=/srv/chess-academy/.sentry-auth-token` in `.env.oci`. Compose passes the token only as a BuildKit secret; source maps are deleted after upload. Grafana Explore uses the provisioned Loki datasource; the operations dashboard can filter logs by `service_name`.

## Connect DBeaver

Create a PostgreSQL connection with the database name from `.env.oci`, `POSTGRES_READONLY_USER`, and `POSTGRES_READONLY_PASSWORD`. Set its database host to `localhost`, port to `5432`, and enable DBeaver's SSH tunnel with the VM hostname/IP, SSH username, and private key. The PostgreSQL mapping is loopback-only on the VM, so keep the SSH tunnel enabled while using the connection.

Browse `Schemas > public > Tables`. The read-only role gets SELECT access to existing tables and future tables created by the app role.

## Backups

Use `sh ops/oci/backup-postgres.sh` to create a compressed PostgreSQL dump. It retains seven days under `.backups/` by default. Store or copy those dumps away from the VM (for example, to a separate OCI Object Storage bucket within its free quota or to another machine). A dump stored only on the VM does not protect against VM or disk loss.

After deployment, schedule the script once a day from the VM's crontab. Replace `/srv/chess-academy` with the actual project directory:

```cron
15 2 * * * /bin/sh /srv/chess-academy/ops/oci/backup-postgres.sh >> /var/log/chess-academy-backup.log 2>&1
```

Keep an encrypted copy outside the VM, restrict access to both the dump and logs, and periodically restore a dump into a disposable database. Backups contain student and family contact information, so treat them as private records.
