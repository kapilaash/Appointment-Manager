# Booking and deployment behavior

## Client bookings

Share `https://<PUBLIC_HOSTNAME>/book-demo` with clients. That standalone page is public so a client can choose an available coach and time and enter student contact details. The OCI Caddy configuration exempts only that page, its built frontend assets, and `/api/v1/public/*` from the site-level Basic Auth challenge. Workspace pages and staff APIs remain protected by the existing Basic Auth and application session/role checks.

The public API returns only coach display names, time zones, and available slots. It does not return coach email addresses, meeting links, student records, or appointment listings. Redis applies per-client request limits (5 booking submissions/hour; 120 coach/slot reads/minute), and the form includes an unobtrusive honeypot. A booking is confirmed immediately after submission; the email address is not verified before the slot is reserved.

## Booking writes and notifications

PostgreSQL is the source of truth. A booking transaction writes the appointment and a notification outbox event together. PostgreSQL's exclusion constraint prevents two confirmed appointments from occupying the same coach/time range, even when requests race. The form reuses its idempotency key when the same page session retries after a lost response; the database exclusion constraint still prevents a duplicate booking if the browser was reloaded and has to start over.

The worker polls the durable PostgreSQL outbox every 15 seconds and sends coach/client notifications. Redis is used by ARQ to run the worker and cron schedule, and for sessions and public rate limits; booking notifications are not stored only in Redis. If the worker is restarting, the outbox event remains pending in PostgreSQL and is retried after the worker returns.

## Live updates

The calendar and booking availability refresh every 15 seconds while the page is visible. This is a simple, bounded approach for the current single-academy workload. The database checks the slot again during the final booking transaction, so a stale screen cannot double-book it. If booking traffic grows, server-sent events can reduce update delay without changing the database transaction or outbox design.

## What a code deployment does

The OCI release script builds images, applies the Alembic migration, switches the release symlink, and runs `docker compose up -d`. It performs health checks and can recreate the prior application release if the new one fails. It is a single Compose deployment, not a rolling or blue/green deployment, so replacing the API/frontend containers can cause a brief request interruption. A booking committed before replacement remains in PostgreSQL and its notification remains in the outbox. A request interrupted before commit can be retried; the same form session reuses its idempotency key, and the database constraint prevents concurrent duplicate slots.

For uninterrupted releases, run at least two application replicas behind a load balancer and use expand/contract database migrations so old and new application versions can run against the same schema during rollout.
