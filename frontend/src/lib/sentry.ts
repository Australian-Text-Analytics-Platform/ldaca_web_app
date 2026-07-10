import type * as SentryTypes from '@sentry/react';

type SentryModule = typeof SentryTypes;

interface SentryInitOptions {
  dsn?: string;
  environment?: string;
  release?: string;
  isProduction?: boolean;
}

interface PendingException {
  error: unknown;
  options?: Parameters<SentryModule['captureException']>[1];
}

let sentryModule: SentryModule | null = null;
let sentryReadyPromise: Promise<SentryModule | null> | null = null;
let earlyExceptions: PendingException[] = [];
let removeEarlyListeners: (() => void) | null = null;

/** Buffers browser errors raised while the optional monitoring chunk initializes. */
function listenForEarlyErrors(): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const onError = (event: ErrorEvent) => {
    earlyExceptions.push({ error: event.error ?? new Error(event.message) });
  };
  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    earlyExceptions.push({ error: event.reason });
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onUnhandledRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onUnhandledRejection);
  };
}

/**
 * Initialises the optional Sentry adapter without putting its SDK in the entry
 * chunk. Called by: index.tsx before `createRoot`; synchronous listeners keep
 * pre-root browser failures until the dynamically imported SDK is ready.
 */
export function initSentry(options: SentryInitOptions = {}): Promise<void> {
  const dsn = options.dsn ?? import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return Promise.resolve();
  if (sentryReadyPromise) return sentryReadyPromise.then(() => undefined);

  removeEarlyListeners = listenForEarlyErrors();
  sentryReadyPromise = import('@sentry/react')
    .then((loaded) => {
      sentryModule = loaded;
      loaded.init({
        dsn,
        environment: options.environment ?? import.meta.env.MODE,
        release: options.release ?? import.meta.env.VITE_APP_VERSION,
        tracesSampleRate: (options.isProduction ?? import.meta.env.PROD) ? 0.1 : 1.0,
        replaysSessionSampleRate: 0.1,
        replaysOnErrorSampleRate: 1.0,
        integrations: [loaded.browserTracingIntegration(), loaded.replayIntegration()],
      });
      for (const pending of earlyExceptions) {
        loaded.captureException(pending.error, pending.options);
      }
      earlyExceptions = [];
      removeEarlyListeners?.();
      removeEarlyListeners = null;
      return loaded;
    })
    .catch((error: unknown) => {
      removeEarlyListeners?.();
      removeEarlyListeners = null;
      earlyExceptions = [];
      sentryReadyPromise = null;
      console.error('Could not initialize Sentry:', error);
      return null;
    });
  return sentryReadyPromise.then(() => undefined);
}

/** Reports a caught exception through the configured adapter once it is ready. */
/** Called by: ErrorBoundary for render failures contained by React. */
export function captureException(
  error: unknown,
  options?: Parameters<SentryModule['captureException']>[1],
): void {
  if (sentryModule) {
    sentryModule.captureException(error, options);
    return;
  }
  if (sentryReadyPromise) {
    void sentryReadyPromise.then((loaded) => {
      loaded?.captureException(error, options);
    });
  }
}
