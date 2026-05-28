import * as Sentry from '@sentry/react';

/**
 * Initialises Sentry error monitoring. The DSN is optional — when unset or
 * empty, the app still boots but errors are only logged to console.
 * Called by: index.tsx before `createRoot` so Sentry catches unhandled
 * errors, Promise rejections, and React render-fiber errors.
 */
export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_APP_VERSION,
    tracesSampleRate: import.meta.env.PROD ? 0.1 : 1.0,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    integrations: [Sentry.browserTracingIntegration(), Sentry.replayIntegration()],
  });
}
