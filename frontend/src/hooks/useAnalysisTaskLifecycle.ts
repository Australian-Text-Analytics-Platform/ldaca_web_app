import { useEffect, useRef } from 'react';
import { useAnalysisTaskStatus } from './useAnalysisTaskStatus';
import type { TaskItem } from '../stores/analysisStore';

export interface AnalysisTaskRefreshContext {
  reason: 'terminal';
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
  isTabActive?: boolean;
  workspaceId?: string | null;
  manualActiveTaskId?: string | null;
  fallbackRunningBanner?: BannerFallbackInput;
  onRefresh?: (context: AnalysisTaskRefreshContext) => Promise<void> | void;
}

export interface UseAnalysisTaskLifecycleResult {
  status: ReturnType<typeof useAnalysisTaskStatus>;
  banner: AnalysisTaskBannerState | null;
  activeTaskId: string | null;
  refreshNow: (reason?: AnalysisTaskRefreshContext['reason']) => Promise<void> | void;
}

export const useAnalysisTaskLifecycle = (
  options: UseAnalysisTaskLifecycleOptions
): UseAnalysisTaskLifecycleResult => {
  const {
    taskType,
    isTabActive = true,
    workspaceId = null,
    manualActiveTaskId,
    fallbackRunningBanner,
    onRefresh,
  } = options;

  const status = useAnalysisTaskStatus(taskType);
  const effectiveActiveTaskId = manualActiveTaskId ?? status.activeTaskId ?? null;
  const lastTerminalRef = useRef<{ taskId: string | null; state: TaskItem['state'] | null }>({
    taskId: null,
    state: null,
  });
  const onRefreshRef = useRef<typeof onRefresh>(onRefresh);
  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  const resolveFallbackBanner: BannerFallback | null = (() => {
    if (typeof fallbackRunningBanner === 'function') {
      return fallbackRunningBanner(status);
    }
    return fallbackRunningBanner ?? null;
  })();

  const banner: AnalysisTaskBannerState | null = (() => {
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
  })();

  const refreshNow = async (reason: AnalysisTaskRefreshContext['reason'] = 'terminal') => {
    if (!workspaceId || !onRefreshRef.current) {
      return;
    }

    const context: AnalysisTaskRefreshContext = {
      reason,
      task: status.terminalTask ?? null,
      taskId: status.terminalTask?.task_id ?? null,
      taskState: status.terminalTask?.state ?? null,
    };

    await onRefreshRef.current(context);
  };

  useEffect(() => {
    lastTerminalRef.current = { taskId: null, state: null };
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId || !onRefreshRef.current) {
      return;
    }

    if (!isTabActive) {
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
    const context: AnalysisTaskRefreshContext = {
      reason: 'terminal',
      task: status.terminalTask ?? null,
      taskId,
      taskState,
    };
    void onRefreshRef.current(context);
  }, [workspaceId, status.terminalTask, isTabActive]);

  return {
    status,
    banner,
    activeTaskId: effectiveActiveTaskId,
    refreshNow,
  };
};

export default useAnalysisTaskLifecycle;
