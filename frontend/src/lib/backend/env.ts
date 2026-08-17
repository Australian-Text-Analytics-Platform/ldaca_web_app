import { BACKEND_PORT, BACKEND_API_BASE } from '@/config/env';

/**
 * Centralized environment and API base URL detection for browser, served SPA,
 * test, and Tauri desktop contexts. Every API client consumes this module so
 * reverse-proxy and desktop URL rules stay in one place.
 *
 * Priority order:
 *  1. Explicit override via function argument (tests)
 *  2. Tauri: window.__BACKEND_URL__ (cached after IPC discovery)
 *  3. Runtime config injection (window.__WORDFLOW_CONFIG__.basePath)
 *  4. Vite dev-only env var: VITE_BACKEND_API_BASE (full URL override)
 *  5. Vite dev: localhost/127.0.0.1 -> backend at configured port
 *  6. Default: same-origin /api
 */

declare global {
  interface Window {
    __BACKEND_URL__?: string;
    __WORDFLOW_CONFIG__?: {
      basePath?: string;
    };
  }
}

export interface ApiEnvOptions {
  explicitBase?: string; // override (useful for tests)
  windowLocation?: Location; // injection for testability
  localStorageGet?: (k: string) => string | null; // allow mock
}

/** Resolves the dev backend port used when the SPA is served separately from FastAPI. */
/** Called by: getApiBase in this library module. */
function getBackendPort(): string {
  const port = BACKEND_PORT.trim();
  if (port) return port;
  return '8001';
}

function getRuntimeConfig() {
  if (typeof window === 'undefined') return undefined;
  return window.__WORDFLOW_CONFIG__;
}

export function getRuntimeBasePath(): string | undefined {
  return getRuntimeConfig()?.basePath;
}

/**
 * Returns the `/api` base URL used by generated SDK clients and local fetches,
 * normalizing each runtime's way of telling the frontend where the backend is.
 * Used by: generated-client configuration and the backend-health startup gate.
 * Flow: prefer explicit and desktop overrides, then resolve the served runtime
 * base path before development-only configuration and same-origin fallback.
 */
export function getApiBase(options: ApiEnvOptions = {}): string {
  // 1. Explicit override (tests / callers)
  if (options.explicitBase) return options.explicitBase.replace(/\/$/, '');

  // 2. Tauri desktop app: cached after the connection gate resolves native state
  if (typeof window !== 'undefined' && window.__BACKEND_URL__) {
    return `${window.__BACKEND_URL__}/api`.replace(/\/$/, '');
  }

  if (typeof window === 'undefined') return '/api';

  // 3. Runtime config base path (handles packaged and reverse-proxy serving).
  const runtimeBasePath = getRuntimeBasePath();
  if (typeof runtimeBasePath === 'string') {
    return `${window.location.origin}${runtimeBasePath}/api`;
  }

  // 4. Full URL overrides are a split-development convenience only. Keeping
  // this branch compile-time gated prevents a local URL from entering a
  // distributable SPA and overriding its request-time runtime configuration.
  if (import.meta.env.DEV) {
    const explicit = BACKEND_API_BASE.trim();
    if (explicit) {
      return explicit.replace(/\/$/, '');
    }
  }

  const loc = options.windowLocation ?? window.location;
  const { origin, hostname, port, protocol } = loc;
  const backendPort = getBackendPort();

  // 5. Browser development: local/private hosts → backend at the configured port
  const isBrowserHttp = protocol === 'http:' || protocol === 'https:';
  const isLocalDev =
    isBrowserHttp &&
    (hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(hostname));
  if (isLocalDev) {
    if (port === backendPort) return `${origin}/api`;
    return `http://${hostname}:${backendPort}/api`;
  }

  // 6. Default: same origin /api
  return `${origin}/api`;
}
