import { useEffect, useRef, useState } from 'react';
import type { TaskItem } from '@/stores/analysisStore';
import { getApiBase } from '@/lib/backend/env';

export type TaskEventPayload =
  | { type: 'tasks_snapshot'; tasks?: TaskItem[]; timestamp?: number }
  | { type: 'task_changed'; task?: TaskItem; timestamp?: number }
  | { type: 'task_removed'; task_id?: string; workspace_id?: string; timestamp?: number }
  | { type: 'analysis_save_failed'; task_type?: string; message?: string }
  | {
      type: 'analysis_materialized';
      task_type?: string;
      task_id?: string;
      parent_task_id?: string;
      parent_node_id?: string;
      materialized_path?: string;
      timestamp?: number;
    }
  | { type: 'error'; message?: string }
  | { type: 'heartbeat' }
  | { type: 'workspace_updated' };

interface TaskStreamState {
  status: 'idle' | 'connecting' | 'open' | 'error';
  error: string | null;
  reconnectAttempt: number;
  lastEventTimestamp: number | null;
}

export interface WorkspaceTaskStreamClientState extends TaskStreamState {
  reconnect: () => void;
}

export interface WorkspaceTaskStreamClientOptions {
  enabled?: boolean;
  getAuthHeaders?: () => Record<string, string>;
  onEvent?: (payload: TaskEventPayload) => void;
}

const STREAM_RETRY_BASE_MS = 5000;
const STREAM_RETRY_MAX_MS = 30000;

/**
 * Caps task-stream reconnect backoff so errors recover without busy looping.
 * Used by: local callers in workspace/useWorkspaceTaskStreamClient module because retry attempts need bounded reconnect delay.
 * Flow: multiply the retry base by the current attempt, enforce a minimum first delay, and cap retries at the maximum interval.
 */
const clampRetryDelay = (attempt: number) => {
  const backoff = STREAM_RETRY_BASE_MS * Math.max(1, attempt);
  return Math.min(backoff, STREAM_RETRY_MAX_MS);
};

/**
 * Build the SSE stream URL, embedding the Bearer token as a query parameter
 * when present so that native EventSource (which cannot set custom headers)
 * can authenticate.
 * Used by: local callers in workspace/useWorkspaceTaskStreamClient module.
 * Flow: start from the backend stream endpoint, extract a Bearer token from auth headers, and append it as an encoded query parameter when present.
 */
const buildStreamUrl = (authHeaders: Record<string, string>) => {
  const base = `${getApiBase()}/tasks/stream`;
  const authValue = authHeaders.Authorization ?? authHeaders.authorization;
  if (!authValue) return base;
  const token = authValue.startsWith('Bearer ') ? authValue.slice(7) : authValue;
  if (!token) return base;
  return `${base}?token=${encodeURIComponent(token)}`;
};

/**
 * Opens the backend task SSE stream and exposes reconnect/status state.
 * Used by: useWorkspaceTaskInbox module (rg call sites/imports) because the inbox hook needs connection state and task events from one client.
 * Flow: initialize connection state and callback refs, keep the latest event handler installed, run the EventSource lifecycle effect, and expose manual reconnect.
 */
export const useWorkspaceTaskStreamClient = (
  options: WorkspaceTaskStreamClientOptions = {},
): WorkspaceTaskStreamClientState => {
  const { enabled = true, getAuthHeaders = () => ({}), onEvent } = options;
  const [state, setState] = useState<TaskStreamState>({
    status: 'idle',
    error: null,
    reconnectAttempt: 0,
    lastEventTimestamp: null,
  });

  const reconnectRef = useRef<() => void>(() => {
    // No-op until the connect effect installs the real reconnect handler.
  });
  const onEventRef = useRef<typeof onEvent>(onEvent);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  const reconnect = (() => {
    /**
     * Keeps the reconnect callback stable while the ref target changes.
     * Called by: useWorkspaceTaskStreamClient internal event, effect, or helper flow.
     * Why: because the stream client needs helpers that keep event parsing, connection state, and cleanup in one resilient flow.
     */
    const fn = () => {
      reconnectRef.current();
    };
    return fn;
  })();

  /* eslint-disable react-hooks/set-state-in-effect -- Resetting stream state when disabled; single unconditional reset */
  useEffect(() => {
    if (!enabled) {
      setState({ status: 'idle', error: null, reconnectAttempt: 0, lastEventTimestamp: null });
      reconnectRef.current = () => {
        // No-op: stream is disabled, so there is nothing to reconnect.
      };
      return;
    }

    let active = true;
    let es: EventSource | null = null;
    let reconnectTimer: number | null = null;

    /**
     * Clears any pending manual reconnect timer.
     * Called by: useWorkspaceTaskStreamClient internal event, effect, or helper flow.
     * Why: because the stream client needs helpers that keep event parsing, connection state, and cleanup in one resilient flow.
     */
    const cleanupTimers = () => {
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    /**
     * Closes the current EventSource and pending reconnect work.
     * Called by: useWorkspaceTaskStreamClient internal event, effect, or helper flow.
     * Why: because the stream client needs helpers that keep event parsing, connection state, and cleanup in one resilient flow.
     */
    const closeStream = () => {
      if (es) {
        es.close();
        es = null;
      }
      cleanupTimers();
    };

    /**
     * Schedules the next connection attempt using capped backoff.
     * Called by: useWorkspaceTaskStreamClient internal event, effect, or helper flow.
     * Why: because the stream client needs helpers that keep event parsing, connection state, and cleanup in one resilient flow.
     */
    const scheduleReconnect = (attempt: number) => {
      cleanupTimers();
      const delay = clampRetryDelay(attempt);
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connect(attempt + 1);
      }, delay);
    };

    /**
     * Delivers a parsed stream payload to the latest caller callback.
     * Called by: useWorkspaceTaskStreamClient internal event, effect, or helper flow.
     * Why: because the stream client needs helpers that keep event parsing, connection state, and cleanup in one resilient flow.
     */
    const invokeOnEvent = (payload: TaskEventPayload) => {
      const rawTimestamp = (payload as { timestamp?: number }).timestamp;
      const timestamp = typeof rawTimestamp === 'number' ? rawTimestamp : Date.now();
      setState((prev) => ({ ...prev, lastEventTimestamp: timestamp }));
      try {
        onEventRef.current?.(payload);
      } catch (error) {
        console.error('Task stream event handler failed', error);
      }
    };

    /**
     * Opens an EventSource connection for one reconnect attempt.
     * Called by: useWorkspaceTaskStreamClient internal event, effect, or helper flow.
     * Why: because the stream client needs helpers that keep event parsing, connection state, and cleanup in one resilient flow.
     * Flow: close any prior stream, build the authenticated URL, wire EventSource handlers, and schedule reconnects on failure.
     */
    const connect = (attempt: number) => {
      if (!active) return;
      closeStream();
      setState({
        status: 'connecting',
        error: null,
        reconnectAttempt: attempt,
        lastEventTimestamp: null,
      });

      try {
        const url = buildStreamUrl(getAuthHeaders());
        const source = new EventSource(url, { withCredentials: true });
        es = source;

        source.onopen = () => {
          if (!active) {
            source.close();
            return;
          }
          setState({
            status: 'open',
            error: null,
            reconnectAttempt: 0,
            lastEventTimestamp: Date.now(),
          });
        };

        source.onmessage = (event: MessageEvent<string>) => {
          if (!active) {
            source.close();
            return;
          }
          try {
            const parsed = JSON.parse(event.data) as TaskEventPayload;
            invokeOnEvent(parsed);
          } catch (error) {
            console.warn('Failed to parse SSE payload', event.data, error);
          }
        };

        // Disable EventSource auto-reconnect — use our own backoff logic.
        source.onerror = () => {
          if (!active) {
            source.close();
            return;
          }
          source.close();
          es = null;
          setState({
            status: 'error',
            error: 'EventSource connection error',
            reconnectAttempt: attempt,
            lastEventTimestamp: Date.now(),
          });
          scheduleReconnect(attempt);
        };
      } catch (error) {
        // `active` is flipped to false by the cleanup closure during async teardown; TS narrows it
        // to `true` here and can't see that mutation, so keep this cancellation guard.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (!active) return;
        const message = error instanceof Error ? error.message : 'Connection error';
        setState({
          status: 'error',
          error: message,
          reconnectAttempt: attempt,
          lastEventTimestamp: Date.now(),
        });
        scheduleReconnect(attempt);
      }
    };

    reconnectRef.current = () => {
      if (!active) return;
      closeStream();
      connect(0);
    };

    connect(0);

    return () => {
      active = false;
      reconnectRef.current = () => {
        // No-op after teardown so a stale reconnect call does nothing.
      };
      closeStream();
      setState({ status: 'idle', error: null, reconnectAttempt: 0, lastEventTimestamp: null });
    };
  }, [enabled, getAuthHeaders]);
  /* eslint-enable react-hooks/set-state-in-effect */

  return { ...state, reconnect };
};
