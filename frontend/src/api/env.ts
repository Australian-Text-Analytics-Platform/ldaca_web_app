// Centralized environment & API base URL detection
// Handles:
//  - Explicit override via function argument (tests)
//  - Vite env var override: VITE_BACKEND_API_BASE
//  - Any localhost/127.0.0.1 frontend port -> backend assumed at :8001 (unless already on 8001)
//  - JupyterHub/Binder proxied paths (/user/<name>/proxy/<port>/)
//  - Default same-origin /api
//
// Previous implementation only recognized ports 3000 & 5173 which caused health polling
// to incorrectly target the frontend origin when running dev server on a different port
// (e.g. 4000). This revision broadens the heuristic and adds an explicit override.

export interface ApiEnvOptions {
  explicitBase?: string; // override (useful for tests)
  windowLocation?: Location; // injection for testability
  localStorageGet?: (k: string) => string | null; // allow mock
}

const PROXY_REGEX = /^(.*\/proxy\/)(\d+)(\/|$)/;

export function getApiBase(options: ApiEnvOptions = {}): string {
  // 1. Explicit override (tests / callers)
  if (options.explicitBase) return options.explicitBase.replace(/\/$/, '');

  // 2. Build-time / runtime environment override via Vite (e.g. VITE_BACKEND_API_BASE)
  //    This lets a dev specify: VITE_BACKEND_API_BASE=http://localhost:8001/api
  //    or full URL to remote backend. We don't attempt to validate here beyond trimming.
  if (typeof import.meta !== 'undefined' && (import.meta as any).env) {
    const explicit = (import.meta as any).env.VITE_BACKEND_API_BASE as string | undefined;
    if (explicit && explicit.trim()) {
      return explicit.replace(/\/$/, '');
    }
  }

  if (typeof window === 'undefined') return '/api';

  const loc = options.windowLocation || window.location;
  const { origin, hostname, port, pathname } = loc;

  // 3. Local dev heuristic: ANY localhost/127.0.0.1 frontend port (other than backend) => backend assumed 8001
  //    This solves the previous limitation (only 3000/5173). Keep a small allowlist for future doc but allow any.
  const isLoopback = hostname === 'localhost' || hostname === '127.0.0.1';
  if (isLoopback) {
    // If the current port is already the backend port, we can same-origin /api
    if (port === '8001') return `${origin}/api`;
    return `http://${hostname}:8001/api`;
  }

  // 4. JupyterHub/Binder style proxied path /user/<name>/proxy/<frontendPort>/
  const match = pathname.match(PROXY_REGEX);
  if (match) {
    const prefix = match[1];
    return `${origin}${prefix}8001/api`;
  }

  // 5. Default: same origin /api
  return `${origin}/api`;
}

// Debug helper (opt-in via localStorage)
export const debugEnabled = (key: string, ls: (k: string) => string | null = (k) => (typeof localStorage === 'undefined' ? null : localStorage.getItem(k))) => ls(`debug${key}`) === '1';
