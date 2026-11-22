# Frontend telemetry

Sentry is optional until `VITE_SENTRY_DSN` is set, and its code is only downloaded when a DSN is configured (`errorReporting.ts`). The client sends sampled browser traces and JavaScript exceptions, with personal data collection disabled and request bodies/query strings removed. Browser traces only propagate to `/api` requests. React Router errors use a recovery page that reports the exception.

For readable production stack traces, set `SENTRY_ORG`, `SENTRY_PROJECT`, and provide a short-lived `SENTRY_AUTH_TOKEN` as a BuildKit secret. The Vite plugin uploads hidden source maps and deletes them from the published bundle. The auth token is never a Docker build argument or a runtime variable.

When a release replaces code chunks, open tabs that request a removed chunk reload once automatically (`chunkRecovery.ts`), with a one-minute guard against reload loops.
