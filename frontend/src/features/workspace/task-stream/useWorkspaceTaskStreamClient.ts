import { useEffect, useRef, useState } from 'react';
import { buildBackendEventsUrl } from './taskStreamUrl';

export type BackendEvent =
  | { type: 'stream_ready'; sequence: number; occurred_at: string }
  | {
      type: 'resource_changed';
      sequence: number;
      occurred_at: string;
      resource_type: 'workspace' | 'tab' | 'analysis' | 'user_file_import';
      resource_id: string;
      workspace_id: string | null;
      state: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | null;
      progress: { fraction: number | null; message: string | null } | null;
      revision: number;
    }
  | {
      type: 'resource_progress';
      sequence: number;
      occurred_at: string;
      resource_type: 'analysis' | 'user_file_import';
      resource_id: string;
      workspace_id: string | null;
      state: 'running';
      progress: { fraction: number | null; message: string | null };
      revision: null;
    }
  | {
      type: 'resource_removed';
      sequence: number;
      occurred_at: string;
      resource_type: 'workspace' | 'tab' | 'analysis' | 'user_file_import';
      resource_id: string;
      workspace_id: string | null;
      revision: number | null;
    }
  | {
      type: 'workspace_runtime_changed';
      sequence: number;
      occurred_at: string;
      resource_type: 'workspace';
      resource_id: string;
      workspace_id: string;
      runtime_state: 'closed' | 'open' | 'closing';
      revision: null;
    }
  | { type: 'resync_required'; sequence: number; occurred_at: string };

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
  onEvent?: (payload: BackendEvent) => void;
}

const STREAM_RETRY_BASE_MS = 5000;
const STREAM_RETRY_MAX_MS = 30000;
const EVENT_TYPES: BackendEvent['type'][] = [
  'stream_ready',
  'resource_changed',
  'resource_progress',
  'resource_removed',
  'workspace_runtime_changed',
  'resync_required',
];

const clampRetryDelay = (attempt: number) =>
  Math.min(STREAM_RETRY_BASE_MS * Math.max(1, attempt), STREAM_RETRY_MAX_MS);

const eventTimestamp = (event: BackendEvent): number => {
  const value = Date.parse(event.occurred_at);
  return Number.isNaN(value) ? Date.now() : value;
};

/** Opens the single cookie-authenticated backend event stream. */
export const useWorkspaceTaskStreamClient = (
  options: WorkspaceTaskStreamClientOptions = {},
): WorkspaceTaskStreamClientState => {
  const { enabled = true, onEvent } = options;
  const [state, setState] = useState<TaskStreamState>({
    status: 'idle',
    error: null,
    reconnectAttempt: 0,
    lastEventTimestamp: null,
  });
  const reconnectRef = useRef<() => void>(() => undefined);
  const onEventRef = useRef(onEvent);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  const reconnect = () => {
    reconnectRef.current();
  };

  /* eslint-disable react-hooks/set-state-in-effect -- stream lifecycle owns its status reset */
  useEffect(() => {
    if (!enabled) {
      setState({ status: 'idle', error: null, reconnectAttempt: 0, lastEventTimestamp: null });
      reconnectRef.current = () => undefined;
      return;
    }

    let active = true;
    let source: EventSource | null = null;
    let retryTimer: number | null = null;

    const clearRetry = () => {
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
        retryTimer = null;
      }
    };

    const closeSource = () => {
      source?.close();
      source = null;
      clearRetry();
    };

    const scheduleReconnect = (attempt: number) => {
      clearRetry();
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        connect(attempt + 1);
      }, clampRetryDelay(attempt));
    };

    const handleEvent = (event: MessageEvent<string>) => {
      if (!active) return;
      try {
        const payload = JSON.parse(event.data) as BackendEvent;
        if (typeof payload.type !== 'string') return;
        setState((previous) => ({ ...previous, lastEventTimestamp: eventTimestamp(payload) }));
        onEventRef.current?.(payload);
      } catch (error) {
        console.warn('Failed to parse backend event', event.data, error);
      }
    };

    const connect = (attempt: number) => {
      if (!active) return;
      closeSource();
      setState({
        status: 'connecting',
        error: null,
        reconnectAttempt: attempt,
        lastEventTimestamp: null,
      });
      try {
        const nextSource = new EventSource(buildBackendEventsUrl(), { withCredentials: true });
        source = nextSource;
        nextSource.onopen = () => {
          if (!active) {
            nextSource.close();
            return;
          }
          setState({
            status: 'open',
            error: null,
            reconnectAttempt: 0,
            lastEventTimestamp: Date.now(),
          });
        };
        for (const eventType of EVENT_TYPES) {
          nextSource.addEventListener(eventType, handleEvent as EventListener);
        }
        nextSource.onerror = () => {
          if (!active) return;
          nextSource.close();
          source = null;
          setState({
            status: 'error',
            error: 'Backend event stream connection error',
            reconnectAttempt: attempt,
            lastEventTimestamp: Date.now(),
          });
          scheduleReconnect(attempt);
        };
      } catch (error) {
        setState({
          status: 'error',
          error: error instanceof Error ? error.message : 'Connection error',
          reconnectAttempt: attempt,
          lastEventTimestamp: Date.now(),
        });
        scheduleReconnect(attempt);
      }
    };

    reconnectRef.current = () => {
      if (!active) return;
      closeSource();
      connect(0);
    };
    connect(0);

    return () => {
      active = false;
      reconnectRef.current = () => undefined;
      closeSource();
      setState({ status: 'idle', error: null, reconnectAttempt: 0, lastEventTimestamp: null });
    };
  }, [enabled]);
  /* eslint-enable react-hooks/set-state-in-effect */

  return { ...state, reconnect };
};
