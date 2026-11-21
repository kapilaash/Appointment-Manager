import React from 'react';
import * as Sentry from '@sentry/react';
import {
  createRoutesFromChildren,
  matchRoutes,
  useLocation,
  useNavigationType,
} from 'react-router-dom';

const dsn = import.meta.env.VITE_SENTRY_DSN;

if (dsn) {
  const configuredSampleRate = Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE ?? '0.05');
  const tracesSampleRate = Number.isFinite(configuredSampleRate)
    ? Math.min(1, Math.max(0, configuredSampleRate))
    : 0.05;

  Sentry.init({
    dsn,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE || undefined,
    sendDefaultPii: false,
    tracesSampleRate,
    tracePropagationTargets: [/^\/api(?:\/|$)/],
    ignoreErrors: [/A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received/],
    integrations: [
      Sentry.reactRouterV7BrowserTracingIntegration({
        useEffect: React.useEffect,
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
        if (requestId) {
          event.tags = { ...event.tags, request_id: requestId };
        }
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
}
