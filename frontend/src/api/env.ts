// Centralized environment & API base URL detection
// Priority order:
//  1. Explicit override via function argument (tests)
//  2. Tauri: window.__BACKEND_URL__ (injected by Rust)
//  3. Vite env var: VITE_BACKEND_API_BASE (full URL override)
//  4. Server-injected window.__BASE_PATH__ (works for any reverse proxy)
//  5. Vite dev: localhost/127.0.0.1 -> backend at configured port
//  6. Default: same-origin /api

declare global {
  interface Window {
    __BACKEND_URL__?: string;
    __BASE_PATH__?: string;
  }
}

export interface ApiEnvOptions {
  explicitBase?: string; // override (useful for tests)
  windowLocation?: Location; // injection for testability
  localStorageGet?: (k: string) => string | null; // allow mock
}

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

  // 2. Tauri desktop app: injected by Rust at startup
  if (typeof window !== 'undefined' && window.__BACKEND_URL__) {
    return `${window.__BACKEND_URL__}/api`.replace(/\/$/, '');
  }

  // 3. Build-time env var override (e.g. VITE_BACKEND_API_BASE=http://host/api)
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    const explicit = import.meta.env.VITE_BACKEND_API_BASE;
    if (explicit && explicit.trim()) {
      return explicit.replace(/\/$/, '');
    }
  }

  if (typeof window === 'undefined') return '/api';

  // 4. Server-injected base path (handles any reverse proxy generically)
  if (window.__BASE_PATH__) {
    return `${window.location.origin}${window.__BASE_PATH__}/api`;
  }

  const loc = options.windowLocation || window.location;
  const { origin, hostname, port } = loc;
  const backendPort = getBackendPort();

  // 5. Local dev: localhost/127.0.0.1/tauri.localhost → backend at configured port
  const isLoopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === 'tauri.localhost';
  if (isLoopback) {
    if (port === backendPort) return `${origin}/api`;
    if (hostname === 'tauri.localhost') {
      return `http://127.0.0.1:${backendPort}/api`;
    }
    return `http://${hostname}:${backendPort}/api`;
  }

  // 6. Default: same origin /api
  return `${origin}/api`;
}
