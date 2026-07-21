import { useEffect, useRef } from 'react';
import {
  getTaskTypeCandidates,
  normalizeTaskDedupeKey,
} from '@/features/views/common/analysisTaskUtils';
import { useAnalysisTaskStatus } from '@/features/views/common/useAnalysisTaskStatus';
import { shouldRefreshOnCompletion } from './policies';
import type {
  AnalysisTaskBannerFallback,
  AnalysisTaskFlowRefreshContext,
  UseAnalysisTaskFlowOptions,
  UseAnalysisTaskFlowResult,
} from './types';

/**
 * Adapts shared task-inbox status into the banner and terminal refresh contract
 * used by every analysis tab.
 * Used by: useAnalysisFeature to bridge task-inbox status into feature UI state.
 * Flow: scope task status to the owning workspace/tab, derive the fallback
 * banner, refresh one matching terminal task, and expose only status and banner.
 */
export const useAnalysisTaskFlow = (
  options: UseAnalysisTaskFlowOptions,
): UseAnalysisTaskFlowResult => {
  const {
    taskType,
    isTabActive = true,
    workspaceId = null,
    taskIds,
    manualActiveTaskId,
    fallbackRunningBanner,
    refreshResults,
  } = options;

  const taskTypeCandidates = getTaskTypeCandidates(taskType);
  const status = useAnalysisTaskStatus({
    taskTypes: taskTypeCandidates,
    workspaceId,
    taskIds,
  });
  const taskIdsKey = taskIds?.join('\0') ?? null;
  const effectiveActiveTaskId = manualActiveTaskId ?? status.activeTaskId ?? null;
  const terminalRefreshDedupeRef = useRef<string | null>(null);
  const refreshResultsRef = useRef<typeof refreshResults>(refreshResults);

  useEffect(() => {
    refreshResultsRef.current = refreshResults;
  }, [refreshResults]);

  useEffect(() => {
    terminalRefreshDedupeRef.current = null;
  }, [workspaceId, taskIdsKey]);

  const resolvedFallbackBanner: AnalysisTaskBannerFallback | null = (() => {
    if (typeof fallbackRunningBanner === 'function') {
      return fallbackRunningBanner(status);
    }
    return fallbackRunningBanner ?? null;
  })();

  const banner = (() => {
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- empty trimmed message should collapse to undefined
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
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- empty trimmed message should collapse to undefined
        message: resolvedFallbackBanner.message?.trim() || undefined,
      };
    }

    return null;
  })();

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

  return {
    status,
    banner,
  };
};
