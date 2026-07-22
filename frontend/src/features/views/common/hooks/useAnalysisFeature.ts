import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { cancelAnalysis, clearTabAnalysis } from '@/api';
import type { Analysis } from '@/api';
import type { TaskItem } from '@/features/workspace/task-stream/taskProjection';
import { queryKeys } from '@/lib/queryKeys';
import type {
  AnalysisTaskBannerState,
  AnalysisTaskStatus,
  CanonicalAnalysisTaskType,
} from '../tasks/types';
import { useAnalysisSession, type HydrationState } from './useAnalysisSession';

export interface ClearAnalysisUiOptions {
  preserveLocalState?: boolean;
}

interface UseAnalysisFeatureConfig<TResult = unknown, TRequest = unknown> {
  taskType: CanonicalAnalysisTaskType | (string & {});
  workspaceId: string | null;
  tabId: string;
  resultQuery?: Readonly<Record<string, unknown>>;
  fetchResult: (taskId: string, query?: Readonly<Record<string, unknown>>) => Promise<TResult>;
  onRequest?: (request: TRequest) => void | Promise<void>;
  onCleared: (clearedTaskIds: string[], options?: ClearAnalysisUiOptions) => void;
  hydrationTaskId: string | null;
}

interface UseAnalysisFeatureReturn<TResult, TRequest> {
  analysisId: string | null;
  request: TRequest | null;
  analysisState: Analysis['state'] | null;
  analysisError: string | null;
  result: TResult | null;
  setLocalTaskId: React.Dispatch<React.SetStateAction<string | null>>;
  resolveTaskId: () => Promise<string | null>;
  isRunning: boolean;
  isStopping: boolean;
  setIsRunning: (running: boolean) => void;
  runningRef: React.RefObject<boolean>;
  taskStatus: AnalysisTaskStatus;
  banner: AnalysisTaskBannerState | null;
  lastFetchedRef: React.RefObject<{ taskId: string | null; state: string | null }>;
  hydrationState: HydrationState;
  stopTask: () => Promise<void>;
  clearResults: (options?: ClearAnalysisUiOptions) => Promise<boolean>;
}

const taskState = (analysis: Analysis): TaskItem['state'] =>
  analysis.state === 'succeeded' ? 'successful' : analysis.state;

const analysisTask = (analysis: Analysis, workspaceId: string, taskType: string): TaskItem => ({
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
  const lastFetchedRef = useRef<{ taskId: string | null; state: string | null }>({
    taskId: null,
    state: null,
  });
  const appliedRequestIdRef = useRef<string | null>(null);
  const analysisId = config.hydrationTaskId ?? localTaskId;
  const session = useAnalysisSession<TResult>({
    workspaceId: config.workspaceId,
    analysisId,
    resultQuery: config.resultQuery,
    loadResult: async (_workspaceId, ownedAnalysisId) => {
      return configRef.current.fetchResult(ownedAnalysisId, configRef.current.resultQuery);
    },
  });

  const analysis = session.analysis;
  const result = session.result;
  const lifecycleRunning = analysis?.state === 'queued' || analysis?.state === 'running';
  const isRunning = analysis ? lifecycleRunning : localRunning;

  // Stable identity is required by existing task-dispatch hooks that store this
  // function alongside `runningRef` while a submission is in flight.
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
    lastFetchedRef.current = { taskId: null, state: null };
  }, [config.workspaceId, analysisId]);

  useEffect(() => {
    if (!analysis || appliedRequestIdRef.current === analysis.id) return;
    appliedRequestIdRef.current = analysis.id;
    void configRef.current.onRequest?.(analysis.request as TRequest);
  }, [analysis]);

  useEffect(() => {
    if (!analysisId || !result) return;
    lastFetchedRef.current = { taskId: analysisId, state: 'successful' };
  }, [analysisId, result]);

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
  const hydrationState: HydrationState = {
    status: session.isLoading
      ? 'loading'
      : session.lifecycleError || session.resultError
        ? 'error'
        : 'idle',
    error:
      session.lifecycleError ??
      (session.resultError instanceof Error ? session.resultError.message : undefined),
  };

  const resolveTaskId = () => Promise.resolve(analysisId);

  const clearResults = async (options?: ClearAnalysisUiOptions): Promise<boolean> => {
    const cfg = configRef.current;
    if (!cfg.workspaceId) return false;
    try {
      await clearTabAnalysis({
        path: { workspace_id: cfg.workspaceId, tab_id: cfg.tabId },
        throwOnError: true,
      });
      const clearedIds = analysisId ? [analysisId] : [];
      if (analysisId) {
        queryClient.removeQueries({
          queryKey: queryKeys.analysisSession(cfg.workspaceId, analysisId),
        });
      }
      void queryClient.invalidateQueries({
        queryKey: queryKeys.workspaceAnalyses(cfg.workspaceId),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspaceTabs(cfg.workspaceId) });
      setLocalTaskId(null);
      setIsRunning(false);
      cfg.onCleared(clearedIds, options);
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not clear the analysis.');
      return false;
    }
  };

  const stopTask = async (): Promise<void> => {
    const cfg = configRef.current;
    if (!cfg.workspaceId || !analysisId) return;
    setIsStopping(true);
    try {
      const { data } = await cancelAnalysis({
        path: { workspace_id: cfg.workspaceId, analysis_id: analysisId },
        throwOnError: true,
      });
      queryClient.setQueryData(queryKeys.analysis(cfg.workspaceId, analysisId), data);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not stop the analysis.');
    } finally {
      setIsStopping(false);
    }
  };

  return {
    analysisId,
    request: session.request as TRequest | null,
    analysisState: analysis?.state ?? null,
    analysisError: analysis?.error?.message ?? null,
    result,
    setLocalTaskId,
    resolveTaskId,
    isRunning,
    isStopping,
    setIsRunning,
    runningRef,
    taskStatus,
    banner,
    lastFetchedRef,
    hydrationState,
    stopTask,
    clearResults,
  };
}
