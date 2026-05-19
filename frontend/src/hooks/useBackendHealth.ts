import { useEffect, useState } from 'react';
import { getApiBase } from '../api/env';
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

const normalizeToHealthUrl = (backendUrl: string) => {
  const trimmed = backendUrl.replace(/\/$/, '');
  return trimmed.endsWith('/api')
    ? trimmed.replace(/\/api$/, '/health')
    : `${trimmed}/health`;
};

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

    const scheduleNext = () => {
      if (cancelled) return;
      const nextDelay = attempt <= 6
        ? 500
        : Math.min(5000, 1000 * 2 ** Math.min(5, attempt - 6));
      timeoutId = window.setTimeout(poll, nextDelay);
    };

    const poll = async () => {
      attempt += 1;
      try {
        const resp = await fetch(healthUrl, { cache: 'no-store' });
        if (resp.ok) {
          // Accept `{ status: 'healthy' | 'operational' }`, but also treat a
          // 2xx response with no JSON body as healthy — older deployments
          // return a plain text "OK".
          let healthy = true;
          try {
            const body = await resp.json();
            healthy = Boolean(body && (body.status === 'healthy' || body.status === 'operational'));
          } catch {
            /* non-JSON body treated as healthy */
          }
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
