import { useEffect, useState } from 'react';
import { resolveBackendConnection } from '@/lib/backend/backendConnection';

/**
 * Polls `GET /health` until the backend responds successfully.
 *
 * The shared connection resolver keeps browser environment/same-origin rules
 * and Tauri IPC discovery behind one readiness boundary.
 *
 * Returns `{ ready, error }`. `ready` flips once the server answers 2xx with
 * `{ status: 'ready' }`; `error` surfaces the most recent
 * failure reason but polling continues until `ready` is true.
 *
 * Backoff: six fast attempts (500 ms) then exponential up to 5 s.
 */

/** Polls backend readiness for the blocking startup screen. */
/**
 * Used by: BackendConnectionGate because backend-dependent UI must not mount
 * until the active runtime has configured the generated client and answered
 * its canonical health check.
 */
export const useBackendHealth = () => {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let attempt = 0;
    let timeoutId: number | null = null;
    const isCancelled = () => cancelled;

    /** Applies the health-poll backoff after failed attempts. */
    /** Called by: `poll` after an unsuccessful health check. */
    const scheduleNext = () => {
      if (cancelled) return;
      const nextDelay = attempt <= 6 ? 500 : Math.min(5000, 1000 * 2 ** Math.min(5, attempt - 6));
      timeoutId = window.setTimeout(() => {
        void poll();
      }, nextDelay);
    };

    /** Performs one health check and schedules another unless the backend is ready. */
    /**
     * Called by: the polling effect because backend startup can lag behind the frontend shell in desktop and dev modes.
     * Flow: fetch the health URL without cache, accept the backend's exact readiness status, otherwise store the failure and schedule the next retry.
     */
    const poll = async () => {
      attempt += 1;
      try {
        const connection = await resolveBackendConnection();
        if (isCancelled()) return;
        const resp = await fetch(connection.healthUrl, { cache: 'no-store' });
        if (isCancelled()) return;
        if (resp.ok) {
          const body: unknown = await resp.json();
          if (isCancelled()) return;
          const healthy =
            typeof body === 'object' &&
            body !== null &&
            'status' in body &&
            body.status === 'ready';
          if (healthy) {
            setReady(true);
            setError(null);
            return;
          }
        }
        throw new Error(`HTTP ${String(resp.status)}`);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : typeof err === 'string'
                ? err
                : 'Backend not reachable',
          );
        }
        scheduleNext();
      }
    };

    void poll();

    return () => {
      cancelled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, []);

  return { ready, error };
};
