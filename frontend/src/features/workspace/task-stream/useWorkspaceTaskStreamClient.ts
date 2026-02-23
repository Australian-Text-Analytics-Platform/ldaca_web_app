import { useEffect, useMemo, useRef, useState } from 'react';
import { getApiBase } from '@/api/env';

export type TaskEventPayload =
  | { type: 'tasks_snapshot'; tasks?: any[] }
  | { type: 'task_changed'; task?: any; timestamp?: number }
  | { type: 'analysis_save_failed'; task_type?: string; message?: string }
  | { type: 'task_update'; tasks?: any[] }
  | { type: 'error'; message?: string }
  | { type: 'heartbeat' }
  | { type: string; [key: string]: any };

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

const buildUrl = (workspaceId: string | null) => {
  const baseUrl = getApiBase();
  if (workspaceId) {
    return `${baseUrl}/tasks/stream?workspace_id=${encodeURIComponent(workspaceId)}`;
  }
  return `${baseUrl}/tasks/stream`;
};

const parseSseFrame = (frame: string, onMessage: (message: TaskEventPayload) => void) => {
  if (!frame.trim()) return;

  const dataLines = frame
    .split(/\r?\n/)
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => /^data:\s?/.test(line))
    .map((line) => line.replace(/^data:\s?/, ''));

  if (!dataLines.length) return;

  const raw = dataLines.join('\n');
  if (!raw.trim()) return;

  try {
    const parsed = JSON.parse(raw) as TaskEventPayload;
    onMessage(parsed);
  } catch (error) {
    console.warn('Failed to parse SSE payload', raw, error);
  }
};

const parseSseFrames = (buffer: string, onMessage: (message: TaskEventPayload) => void) => {
  const frames = buffer.split(/\r?\n\r?\n/);
  const remainder = frames.pop() ?? '';

  for (const frame of frames) {
    parseSseFrame(frame, onMessage);
  }

  return remainder;
};

export const useWorkspaceTaskStreamClient = (
  workspaceId: string | null,
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

  const reconnect = useMemo(() => {
    const fn = () => reconnectRef.current();
    return fn;
  }, []);

  useEffect(() => {
    if (!enabled) {
      setState({ status: 'idle', error: null, reconnectAttempt: 0, lastEventTimestamp: null });
      reconnectRef.current = () => {};
      return;
    }

    let active = true;
    let abortController: AbortController | null = null;
    let reconnectTimer: number | null = null;
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    let buffer = '';
    const decoder = new TextDecoder();

    const cleanupTimers = () => {
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const closeStream = () => {
      if (reader) {
        try {
          reader.releaseLock();
        } catch (_) {
          /* noop */
        }
        reader = null;
      }
      if (abortController) {
        abortController.abort();
        abortController = null;
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
      const timestamp = typeof (payload as { timestamp?: number }).timestamp === 'number'
        ? (payload as { timestamp?: number }).timestamp!
        : Date.now();
      setState((prev) => ({ ...prev, lastEventTimestamp: timestamp }));
      try {
        onEventRef.current?.(payload);
      } catch (error) {
        console.error('Task stream event handler failed', error);
      }
    };

    const readLoop = async () => {
      if (!reader) return;
      try {
        while (active) {
          const { done, value } = await reader.read();
          if (done) {
            // Flush any final frame even when the stream ends without
            // a trailing blank-line delimiter.
            parseSseFrame(buffer, invokeOnEvent);
            buffer = '';
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          buffer = parseSseFrames(buffer, invokeOnEvent);
        }
      } catch (error) {
        if (active) {
          console.warn('Task stream read failed', error);
          setState((prev) => ({
            ...prev,
            status: 'error',
            error: 'Stream processing error',
          }));
        }
      }
    };

    const connect = async (attempt: number) => {
      if (!active) return;
      setState({ status: 'connecting', error: null, reconnectAttempt: attempt, lastEventTimestamp: null });

      try {
        abortController = new AbortController();
        const response = await fetch(buildUrl(workspaceId), {
          method: 'GET',
          headers: {
            Accept: 'text/event-stream',
            'Cache-Control': 'no-cache',
            ...getAuthHeaders(),
          },
          credentials: 'include',
          signal: abortController.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        if (!response.body) {
          throw new Error('Task stream response body missing');
        }

        reader = response.body.getReader();
        buffer = '';
        setState({ status: 'open', error: null, reconnectAttempt: attempt, lastEventTimestamp: Date.now() });
        await readLoop();

        if (active) {
          throw new Error('Task stream closed unexpectedly');
        }
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
  }, [workspaceId, enabled, getAuthHeaders]);

  return { ...state, reconnect };
};

export default useWorkspaceTaskStreamClient;
