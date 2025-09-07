// Centralized environment & API base URL detection
// Handles localhost dev, production same-origin, and JupyterHub/Binder proxy patterns.

export interface ApiEnvOptions {
  explicitBase?: string; // override (useful for tests)
  windowLocation?: Location; // injection for testability
  localStorageGet?: (k: string) => string | null; // allow mock
}

const PROXY_REGEX = /^(.*\/proxy\/)(\d+)(\/|$)/;

export function getApiBase(options: ApiEnvOptions = {}): string {
  if (options.explicitBase) return options.explicitBase.replace(/\/$/, '');
  if (typeof window === 'undefined') return '/api';

  const loc = options.windowLocation || window.location;
  const { origin, hostname, port, pathname } = loc;

  // Local dev: common frontend ports -> backend 8001
  if (hostname === 'localhost' && (port === '3000' || port === '5173')) {
    return 'http://localhost:8001/api';
  }

  // JupyterHub/Binder style proxied path /user/<name>/proxy/<frontendPort>/
  const match = pathname.match(PROXY_REGEX);
  if (match) {
    const prefix = match[1];
    return `${origin}${prefix}8001/api`;
  }

  // Default: same origin /api
  return `${origin}/api`;
}

// Debug helper (opt-in via localStorage)
export const debugEnabled = (key: string, ls: (k: string) => string | null = (k) => (typeof localStorage === 'undefined' ? null : localStorage.getItem(k))) => ls(`debug${key}`) === '1';
