import { useEffect, useState } from 'react';
import { getApiBase } from '../api/env';

/**
 * Polls the backend /health endpoint until it responds successfully.
 * Returns { ready, error } where:
 *  - ready: boolean indicating backend is reachable & healthy
 *  - error: last error message (not fatal; polling continues)
 *
 * Poll strategy: fast attempts first (0.5s * 6) then back off (1s, 2s, 4s...) up to max 5s interval.
 * Stops polling once ready.
 */
export const useBackendHealth = () => {
  const [ready, setReady] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [healthUrl, setHealthUrl] = useState<string | null>(null);

  console.warn('[Health Check] Hook initialized, window.__BACKEND_URL__:', 
    typeof window !== 'undefined' ? window.__BACKEND_URL__ : 'N/A');

  useEffect(() => {
    let cancelled = false;

    const resolveHealthUrl = async () => {
      try {
        if (typeof window !== 'undefined') {
          if (window.__BACKEND_URL__) {
            const normalizedBackend = window.__BACKEND_URL__.replace(/\/$/, '');
            const healthEndpoint = `${normalizedBackend}/health`;
            console.warn('[Health Check] Using Tauri injected URL:', healthEndpoint);
            if (!cancelled) {
              setHealthUrl(healthEndpoint);
            }
            return;
          }

          if ('__TAURI_INTERNALS__' in window) {
            try {
              const { invoke } = await import('@tauri-apps/api/core');
              const backendUrl = await invoke<string>('get_backend_url');
              if (backendUrl && !cancelled) {
                const normalizedBackend = backendUrl.replace(/\/$/, '');
                const healthEndpoint = `${normalizedBackend}/health`;
                console.warn('[Health Check] Using Tauri invoke URL:', healthEndpoint);
                window.__BACKEND_URL__ = normalizedBackend;
                setHealthUrl(healthEndpoint);
                return;
              }
            } catch (tauriErr) {
              console.error('Failed to resolve backend URL via Tauri invoke', tauriErr);
            }
          }
        }

        const base = getApiBase();
        const normalizedBase = base.replace(/\/$/, '');
        const resolved = normalizedBase.endsWith('/api')
          ? normalizedBase.replace(/\/api$/, '/health')
          : `${normalizedBase}/health`;
        console.warn('[Health Check] Using fallback URL:', resolved);
        if (!cancelled) {
          setHealthUrl(resolved);
        }
      } catch (err) {
        console.error('Failed to resolve backend health URL', err);
        if (!cancelled) {
          setHealthUrl('/health');
        }
      }
    };

    resolveHealthUrl();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!healthUrl) return;

    let cancelled = false;
    let attempt = 0;
    let timeoutId: number | null = null;

    const poll = async () => {
      attempt += 1;
      try {
        const resp = await fetch(healthUrl, { cache: 'no-store' });
        if (resp.ok) {
          let healthy = true;
          let responseData = null;
          try {
            responseData = await resp.json();
            healthy = Boolean(
              responseData && (responseData.status === 'healthy' || responseData.status === 'operational')
            );
          } catch {
            healthy = true; // Treat a 2xx with no JSON as success
          }

          if (healthy) {
            console.warn('[Health Check] ✓ Backend is healthy!', { healthUrl, response: responseData });
            if (!cancelled) {
              setReady(true);
              setError(null);
            }
            return;
          }
        }
        throw new Error(`HTTP ${resp.status}`);
      } catch (err: unknown) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'Backend not reachable';
          setError(message);
        }
      }
      if (cancelled) return;
      const nextDelay = attempt <= 6
        ? 500
        : Math.min(5000, 1000 * 2 ** Math.min(5, attempt - 6));
      timeoutId = window.setTimeout(poll, nextDelay);
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
