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

export interface TaskStreamState {
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

const clampRetryDelay = (attempt: number) => {
  const backoff = STREAM_RETRY_BASE_MS * Math.max(1, attempt);
  return Math.min(backoff, STREAM_RETRY_MAX_MS);
};

/**
 * Build the SSE stream URL, embedding the Bearer token as a query parameter
 * when present so that native EventSource (which cannot set custom headers)
 * can authenticate.
 */
const buildStreamUrl = (authHeaders: Record<string, string>) => {
  const base = `${getApiBase()}/tasks/stream`;
  const authValue = authHeaders.Authorization ?? authHeaders.authorization;
  if (!authValue) return base;
  const token = authValue.startsWith('Bearer ') ? authValue.slice(7) : authValue;
  if (!token) return base;
  return `${base}?token=${encodeURIComponent(token)}`;
};

export const useWorkspaceTaskStreamClient = (
  options: WorkspaceTaskStreamClientOptions = {}
): WorkspaceTaskStreamClientState => {
  const { enabled = true, getAuthHeaders = () => ({}), onEvent } = options;
  const [state, setState] = useState<TaskStreamState>({
    status: 'idle',
    error: null,
    reconnectAttempt: 0,
    lastEventTimestamp: null,
  });

  const reconnectRef = useRef<() => void>(() => {});
  const onEventRef = useRef<typeof onEvent>(onEvent);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  const reconnect = (() => {
    const fn = () => reconnectRef.current();
    return fn;
  })();

  /* eslint-disable react-hooks/set-state-in-effect -- Resetting stream state when disabled; single unconditional reset */
  useEffect(() => {
    if (!enabled) {
      setState({ status: 'idle', error: null, reconnectAttempt: 0, lastEventTimestamp: null });
      reconnectRef.current = () => {};
      return;
    }

    let active = true;
    let es: EventSource | null = null;
    let reconnectTimer: number | null = null;

    const cleanupTimers = () => {
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const closeStream = () => {
      if (es) {
        es.close();
        es = null;
      }
      cleanupTimers();
    };

    const scheduleReconnect = (attempt: number) => {
      cleanupTimers();
      const delay = clampRetryDelay(attempt);
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connect(attempt + 1);
      }, delay);
    };

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

    const connect = (attempt: number) => {
      if (!active) return;
      closeStream();
      setState({ status: 'connecting', error: null, reconnectAttempt: attempt, lastEventTimestamp: null });

      try {
        const url = buildStreamUrl(getAuthHeaders());
        const source = new EventSource(url, { withCredentials: true });
        es = source;

        source.onopen = () => {
          if (!active) { source.close(); return; }
          setState({ status: 'open', error: null, reconnectAttempt: 0, lastEventTimestamp: Date.now() });
        };

        source.onmessage = (event: MessageEvent<string>) => {
          if (!active) { source.close(); return; }
          try {
            const parsed = JSON.parse(event.data) as TaskEventPayload;
            invokeOnEvent(parsed);
          } catch (error) {
            console.warn('Failed to parse SSE payload', event.data, error);
          }
        };

        // Disable EventSource auto-reconnect — use our own backoff logic.
        source.onerror = () => {
          if (!active) { source.close(); return; }
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
        if (!active) return;
        const message = error instanceof Error ? error.message : 'Connection error';
        setState({ status: 'error', error: message, reconnectAttempt: attempt, lastEventTimestamp: Date.now() });
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
      reconnectRef.current = () => {};
      closeStream();
      setState({ status: 'idle', error: null, reconnectAttempt: 0, lastEventTimestamp: null });
    };
  }, [enabled, getAuthHeaders]);
  /* eslint-enable react-hooks/set-state-in-effect */

  return { ...state, reconnect };
};

export default useWorkspaceTaskStreamClient;
