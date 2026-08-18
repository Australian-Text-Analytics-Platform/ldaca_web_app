import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { Analysis } from '@/api';
import { cancelAnalysis, clearTabAnalysis } from '@/api';
import type { TaskItem } from '@/features/workspace/task-stream/taskProjection';
import { queryKeys } from '@/lib/queryKeys';
import type {
  AnalysisTaskBannerState,
  AnalysisTaskStatus,
  CanonicalAnalysisTaskType,
} from '../tasks/types';
import { useAnalysisSession } from './useAnalysisSession';

interface UseAnalysisFeatureConfig<TResult = unknown, TRequest = unknown> {
  taskType: CanonicalAnalysisTaskType;
  workspaceId: string | null;
  tabId: string;
  resultQuery?: Readonly<Record<string, unknown>>;
  resultRequestKey?: number;
  resultCacheMode?: 'default' | 'no-store';
  fetchResult: (
    taskId: string,
    query?: Readonly<Record<string, unknown>>,
    signal?: AbortSignal,
  ) => Promise<TResult>;
  onRequest: (request: TRequest) => void | Promise<void>;
  onCleared: (clearedTaskIds: string[]) => void;
  hydrationTaskId: string | null;
  requestHydration?: { analysisId: string; request: TRequest } | null;
  controlAnalysisId: string | null;
  tabAnalysisIds: string[];
  retiredAnalysisIds?: string[];
}

interface UseAnalysisFeatureReturn<TResult, TRequest> {
  request: TRequest | null;
  analysisState: Analysis['state'] | null;
  analysisError: string | null;
  result: TResult | null;
  isResultFetching: boolean;
  isResultPlaceholderData: boolean;
  resultError: string | null;
  retryResult: () => void;
  setLocalTaskId: React.Dispatch<React.SetStateAction<string | null>>;
  isRunning: boolean;
  isStopping: boolean;
  setIsRunning: (running: boolean) => void;
  runningRef: React.RefObject<boolean>;
  taskStatus: AnalysisTaskStatus;
  banner: AnalysisTaskBannerState | null;
  stopTask: () => Promise<void>;
  clearResults: () => Promise<boolean>;
}

const taskState = (analysis: Analysis): TaskItem['state'] =>
  analysis.state === 'succeeded' ? 'successful' : analysis.state;

const analysisTask = (
  analysis: Analysis,
  workspaceId: string,
  taskType: CanonicalAnalysisTaskType,
): TaskItem => ({
  resource_type: 'analysis',
  task_id: analysis.id,
  task_type: taskType,
  workspace_id: workspaceId,
  state: taskState(analysis),
  progress: analysis.progress.fraction ?? undefined,
  progress_message: analysis.progress.message ?? undefined,
  message: analysis.error?.message ?? analysis.progress.message ?? undefined,
  error: analysis.error?.message ?? null,
  created_at: analysis.created_at,
  started_at: analysis.started_at,
  finished_at: analysis.finished_at,
});

const taskStatusFor = (task: TaskItem | null): AnalysisTaskStatus => {
  const state = task?.state ?? null;
  const runningTask = state === 'running' ? task : null;
  const queuedTask = state === 'queued' ? task : null;
  const successfulTask = state === 'successful' ? task : null;
  const failedTask = state === 'failed' ? task : null;
  const cancelledTask = state === 'cancelled' ? task : null;
  const terminalTask = successfulTask ?? failedTask ?? cancelledTask;
  const activeTask = runningTask ?? queuedTask;
  return {
    tasks: task ? [task] : [],
    runningTask,
    queuedTask,
    successfulTask,
    failedTask,
    cancelledTask,
    terminalTask,
    activeTaskId: activeTask?.task_id ?? null,
    bannerStatus: runningTask ? 'running' : queuedTask ? 'queued' : null,
    bannerTaskId: activeTask?.task_id ?? null,
    bannerMessage:
      typeof activeTask?.progress_message === 'string' ? activeTask.progress_message : undefined,
  };
};

/**
 * Shared feature controller backed exclusively by the canonical Analysis and
 * Result resources. It does not reconstruct lifecycle state from Results or
 * discover ownership through the Workspace Task Inbox.
 */
export function useAnalysisFeature<TResult = unknown, TRequest = unknown>(
  config: UseAnalysisFeatureConfig<TResult, TRequest>,
): UseAnalysisFeatureReturn<TResult, TRequest> {
  const queryClient = useQueryClient();
  const configRef = useRef(config);
  const [localTaskId, setLocalTaskId] = useState<string | null>(null);
  const [localRunning, setLocalRunning] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const runningRef = useRef(false);
  const appliedRequestIdRef = useRef<string | null>(null);
  const localTaskWasRemoved =
    localTaskId !== null &&
    config.hydrationTaskId !== localTaskId &&
    config.retiredAnalysisIds?.includes(localTaskId) === true;
  const analysisId = config.hydrationTaskId ?? (localTaskWasRemoved ? null : localTaskId);
  const session = useAnalysisSession<TResult>({
    workspaceId: config.workspaceId,
    analysisId,
    resultQuery: config.resultQuery,
    resultRequestKey: config.resultRequestKey,
    resultCacheMode: config.resultCacheMode,
    loadResult: async (_workspaceId, ownedAnalysisId, projectionQuery, signal) => {
      return configRef.current.fetchResult(ownedAnalysisId, projectionQuery, signal);
    },
  });

  const analysis = localTaskWasRemoved ? null : session.analysis;
  const hydratedRequest =
    (analysis?.request as TRequest | undefined) ?? config.requestHydration?.request ?? null;
  const hydratedRequestId = analysis?.id ?? config.requestHydration?.analysisId ?? null;
  const result = localTaskWasRemoved ? null : session.result;
  const lifecycleRunning = analysis?.state === 'queued' || analysis?.state === 'running';
  const isRunning = localTaskWasRemoved ? false : analysis ? lifecycleRunning : localRunning;

  // Task-dispatch hooks keep this callback alongside `runningRef` while a
  // submission is in flight, so its identity must stay stable.
  const setIsRunning = useCallback((running: boolean) => {
    runningRef.current = running;
    setLocalRunning(running);
  }, []);

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  useEffect(() => {
    runningRef.current = isRunning;
  }, [isRunning]);

  useEffect(() => {
    appliedRequestIdRef.current = null;
  }, [config.workspaceId, analysisId]);

  useEffect(() => {
    if (!hydratedRequest || !hydratedRequestId || appliedRequestIdRef.current === hydratedRequestId)
      return;
    appliedRequestIdRef.current = hydratedRequestId;
    void configRef.current.onRequest(hydratedRequest);
  }, [hydratedRequest, hydratedRequestId]);

  const task =
    analysis && config.workspaceId
      ? analysisTask(analysis, config.workspaceId, config.taskType)
      : null;
  const taskStatus = taskStatusFor(task);
  const banner: AnalysisTaskBannerState | null = taskStatus.bannerStatus
    ? {
        status: taskStatus.bannerStatus,
        taskId: taskStatus.bannerTaskId,
        message: taskStatus.bannerMessage,
      }
    : null;
  const clearResults = async (): Promise<boolean> => {
    const cfg = configRef.current;
    if (!cfg.workspaceId) return false;
    try {
      await clearTabAnalysis({
        path: { workspace_id: cfg.workspaceId, tab_id: cfg.tabId },
        throwOnError: true,
      });
      const clearedIds = cfg.tabAnalysisIds;
      for (const clearedId of clearedIds) {
        queryClient.removeQueries({
          queryKey: queryKeys.analysisSession(cfg.workspaceId, clearedId),
        });
      }
      void queryClient.invalidateQueries({
        queryKey: queryKeys.workspaceAnalyses(cfg.workspaceId),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspaceTabs(cfg.workspaceId) });
      setLocalTaskId(null);
      setIsRunning(false);
      cfg.onCleared(clearedIds);
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not clear the analysis.');
      return false;
    }
  };

  const stopTask = async (): Promise<void> => {
    const cfg = configRef.current;
    const controlledAnalysisId = cfg.controlAnalysisId;
    if (!cfg.workspaceId || !controlledAnalysisId) return;
    setIsStopping(true);
    try {
      const { data } = await cancelAnalysis({
        path: { workspace_id: cfg.workspaceId, analysis_id: controlledAnalysisId },
        throwOnError: true,
      });
      queryClient.setQueryData(queryKeys.analysis(cfg.workspaceId, controlledAnalysisId), data);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not stop the analysis.');
    } finally {
      setIsStopping(false);
    }
  };

  return {
    request: hydratedRequest,
    analysisState: analysis?.state ?? null,
    analysisError: analysis?.error?.message ?? null,
    result,
    isResultFetching: session.isResultFetching,
    isResultPlaceholderData: session.isResultPlaceholderData,
    resultError: session.resultError,
    retryResult: session.retryResult,
    setLocalTaskId,
    isRunning,
    isStopping,
    setIsRunning,
    runningRef,
    taskStatus,
    banner,
    stopTask,
    clearResults,
  };
}
