import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './useAuth';
import { getApiBase } from '../api/env';
import { useAnalysisStore } from '../stores/analysisStore';

interface TaskStreamState {
  status: 'idle' | 'connecting' | 'open' | 'error';
  error: string | null;
  reconnectAttempt: number;
  lastEventTimestamp: number | null;
}

interface UseWorkspaceTaskStreamResult extends TaskStreamState {
  reconnect: () => void;
}

type TaskEventPayload =
  | { type: 'tasks_snapshot'; tasks?: any[] }
  | { type: 'task_changed'; task?: any; result_persisted?: boolean; timestamp?: number }
  | { type: 'analysis_saved'; task_type?: string; task_id?: string; timestamp?: number }
  | { type: 'analysis_save_failed'; task_type?: string; message?: string }
  | { type: 'task_update'; tasks?: any[] }
  | { type: 'error'; message?: string }
  | { type: 'heartbeat' }
  | { type: string; [key: string]: any };

const STREAM_RETRY_BASE_MS = 5000;
const STREAM_RETRY_MAX_MS = 30000;

const clampRetryDelay = (attempt: number) => {
  const backoff = STREAM_RETRY_BASE_MS * Math.max(1, attempt);
  return Math.min(backoff, STREAM_RETRY_MAX_MS);
};

const buildUrl = (workspaceId: string) => {
  const baseUrl = getApiBase();
  return `${baseUrl}/workspaces/${workspaceId}/tasks/stream`;
};

const sortTasksByTime = (tasks: any[] = []) =>
  [...tasks].sort((a, b) => {
    const tb = b?.finished_at ?? b?.started_at ?? b?.created_at ?? 0;
    const ta = a?.finished_at ?? a?.started_at ?? a?.created_at ?? 0;
    return tb - ta;
  });

const buildTaskMap = (tasks: any[] = []) => {
  const map = new Map<string, any>();
  tasks.forEach((task) => {
    const taskId = task?.task_id;
    if (taskId) {
      map.set(taskId, task);
    }
  });
  return map;
};

interface TaskMergeUpdate {
  task: any;
  resultPersistedOverride?: boolean;
}

const mergeTaskUpdates = (
  previousTasks: any[] = [],
  updates: TaskMergeUpdate[] = [],
  options: { replaceAll?: boolean } = {}
) => {
  if (!updates.length && !options.replaceAll) {
    return sortTasksByTime(previousTasks);
  }

  const previousMap = buildTaskMap(previousTasks);
  const nextMap = options.replaceAll ? new Map<string, any>() : new Map(previousMap);

  updates.forEach(({ task, resultPersistedOverride }) => {
    if (!task || !task.task_id) return;

    const existing = nextMap.get(task.task_id) ?? previousMap.get(task.task_id);
    const merged = {
      ...existing,
      ...task,
    };

    if (resultPersistedOverride !== undefined) {
      merged.result_persisted = resultPersistedOverride;
    } else if (existing?.result_persisted && !merged.result_persisted) {
      merged.result_persisted = existing.result_persisted;
    }

    nextMap.set(task.task_id, merged);
  });

  return sortTasksByTime(Array.from(nextMap.values()));
};

const parseSseFrames = (buffer: string, onMessage: (message: TaskEventPayload) => void) => {
  const frames = buffer.split('\n\n');
  const remainder = frames.pop() ?? '';

  for (const frame of frames) {
    if (!frame.trim()) continue;
    const dataLines = frame
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => line.slice(6));

    if (!dataLines.length) continue;

    const raw = dataLines.join('\n');
    if (!raw.trim()) continue;

    try {
      const parsed = JSON.parse(raw) as TaskEventPayload;
      onMessage(parsed);
    } catch (error) {
      console.warn('Failed to parse SSE payload', raw, error);
    }
  }

  return remainder;
};

export const useWorkspaceTaskStream = (workspaceId: string | null): UseWorkspaceTaskStreamResult => {
  const { getAuthHeaders } = useAuth();
  const setTasks = useAnalysisStore((state) => state.setTasks);
  const markTopicModelingReady = useAnalysisStore((state) => state.markTopicModelingReady);
  const resetTopicModelingReady = useAnalysisStore((state) => state.resetTopicModelingReady);
  const [state, setState] = useState<TaskStreamState>({
    status: 'idle',
    error: null,
    reconnectAttempt: 0,
    lastEventTimestamp: null,
  });

  const reconnectRef = useRef<() => void>(() => {});

  const reconnect = useMemo(() => {
    const fn = () => reconnectRef.current();
    return fn;
  }, []);

  useEffect(() => {
    if (!workspaceId) {
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

    const handlePayload = (payload: TaskEventPayload) => {
      switch (payload.type) {
        case 'tasks_snapshot': {
          if (Array.isArray(payload.tasks)) {
            setTasks((prevTasks: any[]) =>
              mergeTaskUpdates(
                prevTasks,
                payload.tasks.map((task: any) => ({ task })),
                { replaceAll: true }
              )
            );
            setState((prev) => ({ ...prev, lastEventTimestamp: Date.now() }));
          }
          break;
        }
        case 'task_changed': {
          if (payload.task) {
            const resultPersisted = payload.result_persisted ?? payload.task?.result_persisted;
            setTasks((prevTasks: any[]) =>
              mergeTaskUpdates(prevTasks, [
                {
                  task: payload.task,
                  resultPersistedOverride: resultPersisted,
                },
              ])
            );
            setState((prev) => ({ ...prev, lastEventTimestamp: payload.timestamp ?? Date.now() }));

            if (payload.task?.task_type === 'topic_modeling') {
              if (payload.task.state === 'running') {
                resetTopicModelingReady();
              }
              if (resultPersisted === true && payload.task?.task_id) {
                markTopicModelingReady(payload.task.task_id, payload.timestamp);
              }
            }
          }
          break;
        }
        case 'analysis_saved': {
          if (payload.task_type === 'topic_modeling' && payload.task_id) {
            markTopicModelingReady(payload.task_id, payload.timestamp);
            setTasks((prevTasks: any[]) =>
              mergeTaskUpdates(prevTasks, [
                {
                  task: {
                    task_id: payload.task_id,
                  },
                  resultPersistedOverride: true,
                },
              ])
            );
          }
          setState((prev) => ({ ...prev, lastEventTimestamp: payload.timestamp ?? Date.now() }));
          break;
        }
        case 'analysis_save_failed': {
          if (payload.task_type === 'topic_modeling') {
            setState((prev) => ({
              ...prev,
              status: 'error',
              error: payload.message || 'Analysis save failed',
              lastEventTimestamp: Date.now(),
            }));
          }
          break;
        }
        case 'task_update': {
          if (Array.isArray(payload.tasks)) {
            setTasks((prevTasks: any[]) =>
              mergeTaskUpdates(
                prevTasks,
                payload.tasks.map((task: any) => ({ task })),
                { replaceAll: true }
              )
            );
            setState((prev) => ({ ...prev, lastEventTimestamp: Date.now() }));
          }
          break;
        }
        case 'error': {
          setState((prev) => ({
            ...prev,
            status: 'error',
            error: payload.message || 'Task stream error',
            lastEventTimestamp: Date.now(),
          }));
          break;
        }
        case 'heartbeat': {
          setState((prev) => ({ ...prev, lastEventTimestamp: Date.now() }));
          break;
        }
        default: {
          // Ignore unknown messages but keep heartbeat-like updates
          setState((prev) => ({ ...prev, lastEventTimestamp: Date.now() }));
          break;
        }
      }
    };

    const readLoop = async () => {
      if (!reader) return;
      try {
        while (active) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          buffer = parseSseFrames(buffer, handlePayload);
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
  }, [workspaceId, getAuthHeaders, setTasks, markTopicModelingReady, resetTopicModelingReady]);

  return { ...state, reconnect };
};

export default useWorkspaceTaskStream;
