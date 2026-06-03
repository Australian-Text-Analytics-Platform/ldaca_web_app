import { useEffect, useRef } from 'react';
import { getTaskTypeCandidates, normalizeTaskDedupeKey } from '@/features/views/common/analysisTaskUtils';
import { useAnalysisTaskStatus } from '@/features/views/common/useAnalysisTaskStatus';
import { shouldRefreshOnCompletion } from './policies';
import type {
  AnalysisTaskBannerFallback,
  AnalysisTaskFlowRefreshContext,
  UseAnalysisTaskFlowOptions,
  UseAnalysisTaskFlowResult,
} from './types';

/**
 * Adapts global task-store status into the banner, active-task flag, and terminal
 * refresh callback contract used by every analysis tab.
 * Used by: useAnalysisFeature to bridge global task status into feature UI state because the task flow needs this step to build requests, submit work, persist preferences, and fold backend results into UI state.
 * Flow: normalize caller params, build the backend request, submit or update the task, then merge terminal results and preferences back into UI state.
 */
export const useAnalysisTaskFlow = (
  options: UseAnalysisTaskFlowOptions,
): UseAnalysisTaskFlowResult => {
  const {
    taskType,
    isTabActive = true,
    workspaceId = null,
    manualActiveTaskId,
    fallbackRunningBanner,
    refreshResults,
  } = options;

  const taskTypeCandidates = getTaskTypeCandidates(taskType);
  const status = useAnalysisTaskStatus(taskTypeCandidates);
  const effectiveActiveTaskId = manualActiveTaskId ?? status.activeTaskId ?? null;
  const terminalRefreshDedupeRef = useRef<string | null>(null);
  const refreshResultsRef = useRef<typeof refreshResults>(refreshResults);

  useEffect(() => {
    refreshResultsRef.current = refreshResults;
  }, [refreshResults]);

  useEffect(() => {
    terminalRefreshDedupeRef.current = null;
  }, [workspaceId]);

  const resolvedFallbackBanner: AnalysisTaskBannerFallback | null = (() => {
    if (typeof fallbackRunningBanner === 'function') {
      return fallbackRunningBanner(status);
    }
    return fallbackRunningBanner ?? null;
  })();

  const banner = (() => {
    const trimmedMessage = status.bannerMessage?.trim() || undefined;
    if (status.bannerStatus) {
      return {
        status: status.bannerStatus,
        taskId: status.bannerTaskId,
        message: trimmedMessage,
      };
    }

    if (resolvedFallbackBanner) {
      // When the store already knows the task reached a terminal state and
      // there are no running/queued tasks, the fallback is stale (result ref
      // hasn't been updated yet in this render cycle).  Suppress it so the
      // UI doesn't get stuck showing a "running" banner.
      if (status.terminalTask && !status.runningTask && !status.queuedTask) {
        return null;
      }
      return {
        status: 'running' as const,
        taskId: resolvedFallbackBanner.taskId ?? effectiveActiveTaskId,
        message: resolvedFallbackBanner.message?.trim() || undefined,
      };
    }

    return null;
  })();

  /**
   * Exposes an imperative refresh path for callers that need to reapply results
   * outside the automatic terminal-task effect.
   * Called by: consumers of useAnalysisTaskFlow through the refreshNow return value because the task flow needs this step to build requests, submit work, persist preferences, and fold backend results into UI state.
   */
  const refreshNow = async (reason: AnalysisTaskFlowRefreshContext['reason'] = 'terminal') => {
    if (!workspaceId || !refreshResultsRef.current) {
      return;
    }

    const context: AnalysisTaskFlowRefreshContext = {
      reason,
      task: status.terminalTask ?? null,
      taskId: status.terminalTask?.task_id ?? null,
      taskState: status.terminalTask?.state ?? null,
    };

    await refreshResultsRef.current(context);
  };

  useEffect(() => {
    if (!workspaceId || !refreshResultsRef.current) {
      return;
    }

    const terminalTask = status.terminalTask;
    const taskId = terminalTask?.task_id ?? null;
    const taskState = terminalTask?.state ?? null;
    const terminalTaskType = terminalTask?.task_type ?? null;

    if (
      !shouldRefreshOnCompletion({
        isTabActive,
        taskState,
        taskType,
        completedTaskType: terminalTaskType,
      })
    ) {
      return;
    }

    const dedupeKey = normalizeTaskDedupeKey(taskId, taskState);
    if (!dedupeKey) {
      return;
    }

    if (terminalRefreshDedupeRef.current === dedupeKey) {
      return;
    }

    terminalRefreshDedupeRef.current = dedupeKey;
    const context: AnalysisTaskFlowRefreshContext = {
      reason: 'terminal',
      task: terminalTask ?? null,
      taskId,
      taskState,
    };

    void refreshResultsRef.current(context);
  }, [workspaceId, status.terminalTask, isTabActive, taskType]);

  const hasActiveTask = Boolean(
    effectiveActiveTaskId ||
      status.runningTask?.task_id ||
      status.queuedTask?.task_id ||
      status.terminalTask?.task_id ||
      status.tasks.length > 0,
  );

  return {
    status,
    banner,
    waitingBanner: banner,
    activeTaskId: effectiveActiveTaskId,
    hasActiveTask,
    refreshNow,
  };
};
