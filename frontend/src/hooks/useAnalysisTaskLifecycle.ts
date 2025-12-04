import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useAnalysisTaskStatus } from './useAnalysisTaskStatus';
import type { TaskItem } from '../stores/analysisStore';

export interface AnalysisTaskRefreshContext {
  reason: 'poll' | 'terminal';
  task: TaskItem | null;
  taskId: string | null;
  taskState: TaskItem['state'] | null;
}

export interface AnalysisTaskBannerState {
  status: 'running' | 'queued';
  taskId: string | null;
  message?: string;
}

interface BannerFallback {
  taskId?: string | null;
  message?: string;
}

type BannerFallbackInput =
  | BannerFallback
  | null
  | ((status: ReturnType<typeof useAnalysisTaskStatus>) => BannerFallback | null);

export interface UseAnalysisTaskLifecycleOptions {
  taskType: string;
  workspaceId?: string | null;
  manualActiveTaskId?: string | null;
  fallbackRunningBanner?: BannerFallbackInput;
  onRefresh?: (context: AnalysisTaskRefreshContext) => Promise<void> | void;
  pollWhileActive?: boolean;
  pollIntervalMs?: number;
}

export interface UseAnalysisTaskLifecycleResult {
  status: ReturnType<typeof useAnalysisTaskStatus>;
  banner: AnalysisTaskBannerState | null;
  activeTaskId: string | null;
  refreshNow: (reason?: AnalysisTaskRefreshContext['reason']) => Promise<void> | void;
}

const DEFAULT_POLL_INTERVAL_MS = 5000;

export const useAnalysisTaskLifecycle = (
  options: UseAnalysisTaskLifecycleOptions
): UseAnalysisTaskLifecycleResult => {
  const {
    taskType,
    workspaceId = null,
    manualActiveTaskId,
    fallbackRunningBanner,
    onRefresh,
    pollWhileActive = false,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  } = options;

  const status = useAnalysisTaskStatus(taskType);
  const activeTask = status.runningTask ?? status.queuedTask ?? null;
  const effectiveActiveTaskId = manualActiveTaskId ?? status.activeTaskId ?? null;
  const pollTimerRef = useRef<number | null>(null);
  const lastTerminalRef = useRef<{ taskId: string | null; state: TaskItem['state'] | null }>({
    taskId: null,
    state: null,
  });

  const resolveFallbackBanner = useMemo<BannerFallback | null>(() => {
    if (typeof fallbackRunningBanner === 'function') {
      return fallbackRunningBanner(status);
    }
    return fallbackRunningBanner ?? null;
  }, [fallbackRunningBanner, status]);

  const banner = useMemo<AnalysisTaskBannerState | null>(() => {
    const trimmedMessage = status.bannerMessage?.trim() || undefined;
    if (status.bannerStatus) {
      return {
        status: status.bannerStatus,
        taskId: status.bannerTaskId,
        message: trimmedMessage,
      };
    }

    if (resolveFallbackBanner) {
      return {
        status: 'running',
        taskId: resolveFallbackBanner.taskId ?? effectiveActiveTaskId,
        message: resolveFallbackBanner.message?.trim() || undefined,
      };
    }

    return null;
  }, [status.bannerStatus, status.bannerTaskId, status.bannerMessage, resolveFallbackBanner, effectiveActiveTaskId]);

  const clearPollTimer = useCallback(() => {
    if (pollTimerRef.current !== null) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const invokeRefresh = useCallback(
    async (reason: AnalysisTaskRefreshContext['reason'] = 'poll') => {
      if (!workspaceId || !onRefresh) {
        return;
      }

      const context: AnalysisTaskRefreshContext = {
        reason,
        task: reason === 'terminal' ? status.terminalTask : activeTask,
        taskId:
          reason === 'terminal'
            ? status.terminalTask?.task_id ?? null
            : effectiveActiveTaskId,
        taskState:
          reason === 'terminal'
            ? status.terminalTask?.state ?? null
            : activeTask?.state ?? null,
      };

      await onRefresh(context);
    },
    [workspaceId, onRefresh, status.terminalTask, activeTask, effectiveActiveTaskId]
  );

  useEffect(() => {
    lastTerminalRef.current = { taskId: null, state: null };
    clearPollTimer();
  }, [workspaceId, clearPollTimer]);

  useEffect(() => {
    if (!workspaceId || !onRefresh) {
      clearPollTimer();
      return;
    }

    if (!pollWhileActive || !effectiveActiveTaskId) {
      clearPollTimer();
      return;
    }

    if (pollTimerRef.current !== null) {
      return;
    }

    pollTimerRef.current = window.setInterval(() => {
      void invokeRefresh('poll');
    }, pollIntervalMs);

    return () => {
      clearPollTimer();
    };
  }, [workspaceId, pollWhileActive, effectiveActiveTaskId, pollIntervalMs, invokeRefresh, onRefresh, clearPollTimer]);

  useEffect(() => {
    if (!workspaceId || !onRefresh) {
      return;
    }

    const terminalTask = status.terminalTask;
    const taskId = terminalTask?.task_id ?? null;
    const taskState = terminalTask?.state ?? null;

    if (!taskId || !taskState) {
      return;
    }

    const prev = lastTerminalRef.current;
    if (prev.taskId === taskId && prev.state === taskState) {
      return;
    }

    lastTerminalRef.current = { taskId, state: taskState };
    void invokeRefresh('terminal');
  }, [workspaceId, status.terminalTask, invokeRefresh, onRefresh]);

  useEffect(() => () => clearPollTimer(), [clearPollTimer]);

  return {
    status,
    banner,
    activeTaskId: effectiveActiveTaskId,
    refreshNow: invokeRefresh,
  };
};

export default useAnalysisTaskLifecycle;
