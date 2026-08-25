import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
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
import { getAnalysisResource } from '../analysisApi';
import { useAnalysisSession } from './useAnalysisSession';

export type AnalysisSubmissionAction = 'preview' | 'run_all';

export interface RunAnalysisOptions<TAnalysis extends Analysis> {
  action: AnalysisSubmissionAction;
  resetBeforeRun?: () => void;
  prepare?: () => Promise<void>;
  submit: () => Promise<TAnalysis>;
  onSuccess?: (analysis: TAnalysis) => void;
  onError: (error: unknown) => void;
}

export type RunAnalysis = <TAnalysis extends Analysis>(
  options: RunAnalysisOptions<TAnalysis>,
) => Promise<TAnalysis | null>;

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
  isRunning: boolean;
  isSubmittingRunAll: boolean;
  isStopping: boolean;
  runAnalysis: RunAnalysis;
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
  const [pendingAction, setPendingAction] = useState<AnalysisSubmissionAction | null>(null);
  const [handoff, setHandoff] = useState<{
    action: AnalysisSubmissionAction;
    analysisId: string;
  } | null>(null);
  const [isStopping, setIsStopping] = useState(false);
  const submissionBusyRef = useRef(false);
  const appliedRequestIdRef = useRef<string | null>(null);
  const handoffWasRemoved =
    handoff !== null &&
    !config.tabAnalysisIds.includes(handoff.analysisId) &&
    config.retiredAnalysisIds?.includes(handoff.analysisId) === true;
  const handoffWasAdopted = handoff !== null && config.tabAnalysisIds.includes(handoff.analysisId);
  const effectiveHandoff = handoffWasRemoved || handoffWasAdopted ? null : handoff;
  const previewHandoffId =
    effectiveHandoff?.action === 'preview' ? effectiveHandoff.analysisId : null;
  const analysisId = previewHandoffId ?? config.hydrationTaskId;
  const handoffQuery = useQuery({
    queryKey:
      config.workspaceId && effectiveHandoff
        ? queryKeys.analysis(config.workspaceId, effectiveHandoff.analysisId)
        : queryKeys.inactiveAnalysis,
    enabled: Boolean(config.workspaceId && effectiveHandoff),
    queryFn: async (): Promise<Analysis> => {
      if (!config.workspaceId || !effectiveHandoff) {
        throw new Error('Analysis handoff is not active');
      }
      return getAnalysisResource(config.workspaceId, effectiveHandoff.analysisId);
    },
  });
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

  const analysis = session.analysis;
  const hydratedRequest =
    (analysis?.request as TRequest | undefined) ?? config.requestHydration?.request ?? null;
  const hydratedRequestId = analysis?.id ?? config.requestHydration?.analysisId ?? null;
  const result = session.result;
  const lifecycleRunning = analysis?.state === 'queued' || analysis?.state === 'running';
  const handoffRunning =
    handoffQuery.data?.state === 'queued' || handoffQuery.data?.state === 'running';
  const previewSubmitting =
    pendingAction === 'preview' || (effectiveHandoff?.action === 'preview' && handoffRunning);
  const isSubmittingRunAll =
    pendingAction === 'run_all' || (effectiveHandoff?.action === 'run_all' && handoffRunning);
  const isRunning = previewSubmitting || isSubmittingRunAll || lifecycleRunning;

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  useEffect(() => {
    if ((!handoffWasAdopted && !handoffWasRemoved) || pendingAction !== null) return;
    submissionBusyRef.current = false;
  }, [handoffWasAdopted, handoffWasRemoved, pendingAction]);

  useEffect(() => {
    if (pendingAction !== null || !handoffQuery.data || handoffRunning) return;
    submissionBusyRef.current = false;
  }, [handoffQuery.data, handoffRunning, pendingAction]);

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

  const runAnalysis = async <TAnalysis extends Analysis>({
    action,
    resetBeforeRun,
    prepare,
    submit,
    onSuccess,
    onError,
  }: RunAnalysisOptions<TAnalysis>): Promise<TAnalysis | null> => {
    if (submissionBusyRef.current || configRef.current.controlAnalysisId) return null;
    submissionBusyRef.current = true;
    setPendingAction(action);

    let response: TAnalysis;
    try {
      resetBeforeRun?.();
      await prepare?.();
      response = await submit();
    } catch (error) {
      submissionBusyRef.current = false;
      setPendingAction(null);
      onError(error);
      return null;
    }

    const workspaceId = configRef.current.workspaceId;
    if (workspaceId) {
      queryClient.setQueryData(queryKeys.analysis(workspaceId, response.id), response);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.workspaceAnalyses(workspaceId),
      });
    }
    setHandoff({ action, analysisId: response.id });
    setPendingAction(null);
    if (response.state !== 'queued' && response.state !== 'running') {
      submissionBusyRef.current = false;
    }
    onSuccess?.(response);
    return response;
  };

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
      setPendingAction(null);
      setHandoff(null);
      submissionBusyRef.current = false;
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
    isRunning,
    isSubmittingRunAll,
    isStopping,
    runAnalysis,
    taskStatus,
    banner,
    stopTask,
    clearResults,
  };
}
