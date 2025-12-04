// Centralized environment & API base URL detection
// Handles:
//  - Explicit override via function argument (tests)
//  - Vite env var override: VITE_BACKEND_API_BASE (full URL)
//  - Vite env var: VITE_BACKEND_PORT (port only, defaults to 8001)
//  - Any localhost/127.0.0.1 frontend port -> backend assumed at configured port
//  - JupyterHub/Binder proxied paths (/user/<name>/proxy/<port>/)
//  - Default same-origin /api
//
// Previous implementation only recognized ports 3000 & 5173 which caused health polling
// to incorrectly target the frontend origin when running dev server on a different port
// (e.g. 4000). This revision broadens the heuristic and adds an explicit override.

declare global {
  interface Window {
    __BACKEND_URL__?: string;
  }
}

export interface ApiEnvOptions {
  explicitBase?: string; // override (useful for tests)
  windowLocation?: Location; // injection for testability
  localStorageGet?: (k: string) => string | null; // allow mock
}

const PROXY_REGEX = /^(.*\/proxy\/)(\d+)(\/|$)/;

// Get backend port from env var, default to 8001
function getBackendPort(): string {
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    const port = import.meta.env.VITE_BACKEND_PORT;
    if (port && port.trim()) {
      return port.trim();
    }
  }
  return '8001';
}

export function getApiBase(options: ApiEnvOptions = {}): string {
  // 1. Explicit override (tests / callers)
  if (options.explicitBase) return options.explicitBase.replace(/\/$/, '');

  // 2. Tauri desktop app: check for injected backend URL or call Tauri command
  if (typeof window !== 'undefined') {
    // First check for injected URL (might be set by Rust)
    if (window.__BACKEND_URL__) {
      const tauriUrl = window.__BACKEND_URL__;
      return `${tauriUrl}/api`.replace(/\/$/, '');
    }
    
    // If in Tauri but no URL yet, we'll fall through to other methods
    // The Tauri command will be called asynchronously elsewhere if needed
  }

  // 3. Build-time / runtime environment override via Vite (e.g. VITE_BACKEND_API_BASE)
  //    This lets a dev specify: VITE_BACKEND_API_BASE=http://localhost:8001/api
  //    or full URL to remote backend. We don't attempt to validate here beyond trimming.
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    const explicit = import.meta.env.VITE_BACKEND_API_BASE;
    if (explicit && explicit.trim()) {
      return explicit.replace(/\/$/, '');
    }
  }

  if (typeof window === 'undefined') return '/api';

  const loc = options.windowLocation || window.location;
  const { origin, hostname, port, pathname } = loc;
  const backendPort = getBackendPort();

  // 3. Local dev heuristic: ANY localhost/127.0.0.1 frontend port (other than backend) => backend assumed at configured port
  //    This solves the previous limitation (only 3000/5173). Keep a small allowlist for future doc but allow any.
  //    Also handle Tauri v2 Windows hostname (tauri.localhost)
  const isLoopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === 'tauri.localhost';
  if (isLoopback) {
    // If the current port is already the backend port, we can same-origin /api
    if (port === backendPort) return `${origin}/api`;
    
    // For tauri.localhost, we must target 127.0.0.1 to reach the backend process
    if (hostname === 'tauri.localhost') {
      return `http://127.0.0.1:${backendPort}/api`;
    }
    
    return `http://${hostname}:${backendPort}/api`;
  }

  // 4. JupyterHub/Binder style proxied path /user/<name>/proxy/<frontendPort>/
  const match = pathname.match(PROXY_REGEX);
  if (match) {
    const prefix = match[1];
    return `${origin}${prefix}${backendPort}/api`;
  }

  // 5. Default: same origin /api
  return `${origin}/api`;
}

// Debug helper (opt-in via localStorage)
export const debugEnabled = (key: string, ls: (k: string) => string | null = (k) => (typeof localStorage === 'undefined' ? null : localStorage.getItem(k))) => ls(`debug${key}`) === '1';
