import { useEffect, useState } from 'react';
import { getApiBase } from '@/lib/backend/env';
import { isTauri } from '@/lib/isTauri';

/**
 * Polls `GET /health` until the backend responds successfully.
 *
 * In Tauri desktop builds the backend URL is injected at runtime (either on
 * `window.__BACKEND_URL__` or via the `get_backend_url` command). In the web
 * build we derive it from `getApiBase()` so dev proxies work unchanged.
 *
 * Returns `{ ready, error }`. `ready` flips once the server answers 2xx with
 * `{ status: 'healthy' | 'operational' }`; `error` surfaces the most recent
 * failure reason but polling continues until `ready` is true.
 *
 * Backoff: six fast attempts (500 ms) then exponential up to 5 s.
 */

/** Converts an API/backend base URL into the health endpoint URL the startup gate polls. */
/** Called by: useBackendHealth in this hook module because the hook needs local steps to normalize inputs before exposing stable state to consumers. */
const normalizeToHealthUrl = (backendUrl: string) => {
  const trimmed = backendUrl.replace(/\/$/, '');
  return trimmed.endsWith('/api')
    ? trimmed.replace(/\/api$/, '/health')
    : `${trimmed}/health`;
};

/** Resolves the health URL from Tauri injection, Tauri command, or web API-base rules. */
/**
 * Called by: useBackendHealth because the startup gate needs the same `/health` endpoint across web proxies and packaged desktop launches.
 * Flow: prefer the injected desktop backend URL, ask Tauri for one when needed, cache it on window, then derive the web fallback from getApiBase().
 */
const resolveHealthUrl = async (): Promise<string> => {
  if (typeof window !== 'undefined') {
    if (window.__BACKEND_URL__) {
      return `${window.__BACKEND_URL__.replace(/\/$/, '')}/health`;
    }
    if (isTauri()) {
      const { invoke } = await import('@tauri-apps/api/core');
      const backendUrl = await invoke<string>('get_backend_url');
      if (backendUrl) {
        const normalized = backendUrl.replace(/\/$/, '');
        window.__BACKEND_URL__ = normalized;
        return `${normalized}/health`;
      }
    }
  }
  return normalizeToHealthUrl(getApiBase());
};

/** Polls backend readiness for the blocking startup screen. */
/**
 * Used by: src/App.tsx because app startup must hold the UI until the local or remote backend can answer health checks.
 * Flow: resolve the health URL, poll it with startup backoff, then expose readiness and the latest error to the blocking screen.
 */
export const useBackendHealth = () => {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [healthUrl, setHealthUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    resolveHealthUrl()
      .then((url) => { if (!cancelled) setHealthUrl(url); })
      .catch((err) => {
        console.error('Failed to resolve backend health URL', err);
        if (!cancelled) setHealthUrl('/health');
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!healthUrl) return;

    let cancelled = false;
    let attempt = 0;
    let timeoutId: number | null = null;

    /** Applies the health-poll backoff after failed attempts. */
    /** Called by: useBackendHealth in this hook module because the hook needs local steps to normalize inputs before exposing stable state to consumers. */
    const scheduleNext = () => {
      if (cancelled) return;
      const nextDelay = attempt <= 6
        ? 500
        : Math.min(5000, 1000 * 2 ** Math.min(5, attempt - 6));
      timeoutId = window.setTimeout(poll, nextDelay);
    };

    /** Performs one health check and schedules another unless the backend is ready. */
    /**
      * Called by: the polling effect because backend startup can lag behind the frontend shell in desktop and dev modes.
      * Flow: fetch the health URL without cache, accept healthy/operational statuses, otherwise store the failure and schedule the next retry.
     */
    const poll = async () => {
      attempt += 1;
      try {
        const resp = await fetch(healthUrl, { cache: 'no-store' });
        if (resp.ok) {
          const body = await resp.json();
          const healthy = Boolean(body && (body.status === 'healthy' || body.status === 'operational'));
          if (healthy) {
            if (!cancelled) { setReady(true); setError(null); }
            return;
          }
        }
        throw new Error(`HTTP ${resp.status}`);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Backend not reachable');
        }
        scheduleNext();
      }
    };

    poll();

    return () => {
      cancelled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [healthUrl]);

  return { ready, error };
};

export default useBackendHealth;
