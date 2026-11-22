import { useEffect } from 'react';
import { createRoutesFromChildren, matchRoutes, useLocation, useNavigationType } from 'react-router-dom';

type SentryModule = typeof import('@sentry/react');

const dsn = import.meta.env.VITE_SENTRY_DSN;
let sentry: SentryModule | null = null;
// Errors raised before Sentry finishes loading are kept briefly and sent once it is ready.
const pending: unknown[] = [];
const MAX_PENDING = 20;

/**
 * Load and start Sentry only when a DSN is configured. Importing it on demand keeps
 * roughly 80 KB of JavaScript out of the first download for every visitor.
 */
export async function initErrorReporting(): Promise<void> {
  if (!dsn || sentry) return;
  const module = await import('@sentry/react');
  const configuredSampleRate = Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE ?? '0.05');
  const tracesSampleRate = Number.isFinite(configuredSampleRate)
    ? Math.min(1, Math.max(0, configuredSampleRate))
    : 0.05;

  module.init({
    dsn,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE || undefined,
    sendDefaultPii: false,
    tracesSampleRate,
    tracePropagationTargets: [/^\/api(?:\/|$)/],
    ignoreErrors: [
      /A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received/,
    ],
    integrations: [
      module.reactRouterV7BrowserTracingIntegration({
        useEffect,
        useLocation,
        useNavigationType,
        createRoutesFromChildren,
        matchRoutes,
      }),
    ],
    beforeSend(event) {
      delete event.user;
      if (event.request) {
        const headers = event.request.headers;
        const requestId = headers?.['X-Request-ID'] ?? headers?.['x-request-id'];
        if (requestId) event.tags = { ...event.tags, request_id: requestId };
        delete event.request.data;
        delete event.request.cookies;
        delete event.request.query_string;
        if (event.request.url) {
          try {
            event.request.url = `${new URL(event.request.url).origin}/`;
          } catch {
            delete event.request.url;
          }
        }
      }
      return event;
    },
  });
  sentry = module;
  pending.splice(0).forEach((error) => module.captureException(error));
}

/** Report an unexpected error. A no-op when error tracking is not configured. */
export function reportError(error: unknown): void {
  if (sentry) sentry.captureException(error);
  else if (dsn && pending.length < MAX_PENDING) pending.push(error);
}
