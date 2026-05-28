import { BACKEND_PORT, BACKEND_API_BASE } from '@/config/env';

/**
 * Centralized environment and API base URL detection for browser, served SPA,
 * test, and Tauri desktop contexts. Every API client consumes this module so
 * reverse-proxy and desktop URL rules stay in one place.
 *
 * Priority order:
 *  1. Explicit override via function argument (tests)
 *  2. Tauri: window.__BACKEND_URL__ (injected by Rust)
 *  3. Vite env var: VITE_BACKEND_API_BASE (full URL override)
 *  4. Server-injected window.__BASE_PATH__ (works for any reverse proxy)
 *  5. Vite dev: localhost/127.0.0.1 -> backend at configured port
 *  6. Default: same-origin /api
 */

declare global {
  interface Window {
    __BACKEND_URL__?: string;
    __BASE_PATH__?: string;
  }
}

export type ApiEnvOptions = {
  explicitBase?: string; // override (useful for tests)
  windowLocation?: Location; // injection for testability
  localStorageGet?: (k: string) => string | null; // allow mock
};

/** Resolves the dev backend port used when the SPA is served separately from FastAPI. */
/** Called by: getApiBase in this library module because the library needs this local step to isolate browser, data, or runtime edge cases for importers. */
function getBackendPort(): string {
  const port = BACKEND_PORT.trim();
  if (port) return port;
  return '8001';
}

/**
 * Returns the `/api` base URL used by generated SDK clients and local fetches,
 * normalizing each runtime's way of telling the frontend where the backend is.
 * Why: API callers need one runtime boundary for backend URL, timeout, and response handling.
 * Flow: read runtime configuration, normalize request or response details, then return the backend-facing value.
 */
export function getApiBase(options: ApiEnvOptions = {}): string {
  // 1. Explicit override (tests / callers)
  if (options.explicitBase) return options.explicitBase.replace(/\/$/, '');

  // 2. Tauri desktop app: injected by Rust at startup
  if (typeof window !== 'undefined' && window.__BACKEND_URL__) {
    return `${window.__BACKEND_URL__}/api`.replace(/\/$/, '');
  }

  // 3. Build-time env var override (e.g. VITE_BACKEND_API_BASE=http://host/api)
  const explicit = BACKEND_API_BASE.trim();
  if (explicit) {
    return explicit.replace(/\/$/, '');
  }

  if (typeof window === 'undefined') return '/api';

  // 4. Server-injected base path (handles any reverse proxy generically).
  //    The backend always injects `window.__BASE_PATH__` as a string (even "")
  //    when it serves the frontend, so its *presence* (not truthiness) means
  //    "same-origin" — no port redirect needed.
  if (typeof window.__BASE_PATH__ === 'string') {
    return `${window.location.origin}${window.__BASE_PATH__}/api`;
  }

  const loc = options.windowLocation || window.location;
  const { origin, hostname, port } = loc;
  const backendPort = getBackendPort();

  // 5. Local dev: localhost/127.0.0.1/tauri.localhost/private IPs → backend at configured port
  const isLocalDev =
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === 'tauri.localhost' ||
    /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(hostname);
  if (isLocalDev) {
    if (port === backendPort) return `${origin}/api`;
    if (hostname === 'tauri.localhost') {
      return `http://127.0.0.1:${backendPort}/api`;
    }
    return `http://${hostname}:${backendPort}/api`;
  }

  // 6. Default: same origin /api
  return `${origin}/api`;
}
