import { useEffect, useState } from 'react';
import { getApiBase } from '../api';

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

  useEffect(() => {
    let cancelled = false;
    let attempt = 0;
    let timeoutId: number | null = null;

  // Derive health endpoint: if API base ends with /api strip it to reach root for /health
  const apiBase = getApiBase();
  const healthUrl = apiBase.endsWith('/api') ? apiBase.replace(/\/api$/, '/health') : `${apiBase}/health`;
  const poll = async () => {
      attempt += 1;
      try {
  const resp = await fetch(healthUrl, { cache: 'no-store' });
        if (resp.ok) {
          // Optionally verify JSON shape / status
            // swallow JSON parse errors (treat as not ready)
          try {
            const data = await resp.json();
            if (data && (data.status === 'healthy' || data.status === 'operational')) {
              if (!cancelled) {
                setReady(true);
                setError(null);
              }
              return; // stop polling
            }
          } catch { /* ignore */ }
        }
        throw new Error(`HTTP ${resp.status}`);
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message || 'Backend not reachable');
        }
      }
      if (cancelled) return;
      // Schedule next attempt with backoff
      const nextDelay = attempt <= 6
        ? 500 // 6 quick attempts (~3s)
        : Math.min(5000, 1000 * 2 ** Math.min(5, attempt - 6)); // capped exponential
      timeoutId = window.setTimeout(poll, nextDelay);
    };

    poll();
    return () => {
      cancelled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, []);

  return { ready, error };
};

export default useBackendHealth;
