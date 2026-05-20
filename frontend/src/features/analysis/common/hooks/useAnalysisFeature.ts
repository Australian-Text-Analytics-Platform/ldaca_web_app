import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { textApi } from '@/api/text';
import { resolveAnalysisTaskId } from '@/hooks/analysisTaskUtils';
import { useAnalysisHydration, type HydrationState } from '../useAnalysisHydration';
import { clearAnalysis } from '../clearAnalysis';
import { useAnalysisTaskFlow } from '../tasks/useAnalysisTaskFlow';
import type {
  AnalysisTaskBannerState,
  AnalysisTaskFlowRefreshContext,
  CanonicalAnalysisTaskType,
} from '../tasks/types';
import { analysisServerRequestLockQueryKey, type ServerLockAnalysisType } from './useAnalysisServerRequestLock';
import type { AnalysisTaskStatus } from '@/hooks/useAnalysisTaskStatus';

interface CachedServerLock {
  hasServerRequest: boolean;
  currentTaskId: string | null;
  serverRequest: Record<string, unknown> | null;
}

/** Minimal shape for accessing common result fields via type assertion */
interface AnalysisResultLike {
  state?: string;
  metadata?: { task_id?: string };
}

export interface ClearAnalysisUiOptions {
  preserveLocalState?: boolean;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface UseAnalysisFeatureConfig<TResult = unknown> {
  analysisType: ServerLockAnalysisType;
  taskType: CanonicalAnalysisTaskType | string;
  workspaceId: string | null;
  getAuthHeaders: () => Record<string, string>;
  isTabActive: boolean;

  /** Ref to feature-managed result state — hook reads for banner / clear logic */
  resultRef: { current: TResult | null };

  /** Fetch a task's result from the backend */
  fetchResult: (taskId: string, headers: Record<string, string>) => Promise<TResult | null>;
  /** Optionally fetch a task's request payload (used during hydration) */
  fetchRequest?: (taskId: string, headers: Record<string, string>) => Promise<unknown | null>;

  /** Called when a terminal task result is fetched */
  onResultFetched: (result: TResult, taskId: string) => void;
  /** Called during hydration with the server result */
  onHydratedResult?: (result: TResult | null) => void | Promise<void>;
  /** Called during hydration with the server request */
  onHydratedRequest?: (request: unknown | null) => void | Promise<void>;
  /** Called after the clear lifecycle completes */
  onCleared: (clearedTaskIds: string[], options?: ClearAnalysisUiOptions) => void;

  /**
   * Optional callback to prune global task store entries for the cleared task IDs.
   * When provided, called automatically during clear — features don't need to
   * duplicate the pruneTasksById boilerplate in their onCleared.
   */
  pruneGlobalTasks?: (taskIds: string[]) => void;

  /** Extra task ID candidates for resolution beyond the built-in sources */
  getExtraTaskIdCandidates?: () => Array<string | null | undefined>;
  /** Extra task ID sources used only during clear */
  getClearTaskIdSources?: () => Array<string | null | undefined>;
  /** Custom check for whether the result indicates a running state (default: result.state === 'running') */
  isResultRunning?: (result: TResult | null) => boolean;
}

// ---------------------------------------------------------------------------
// Return
// ---------------------------------------------------------------------------

export interface UseAnalysisFeatureReturn {
  localTaskId: string | null;
  setLocalTaskId: React.Dispatch<React.SetStateAction<string | null>>;
  resolveTaskId: () => Promise<string | null>;

  isRunning: boolean;
  setIsRunning: (running: boolean) => void;
  runningRef: React.MutableRefObject<boolean>;

  taskStatus: AnalysisTaskStatus;
  banner: AnalysisTaskBannerState | null;
  hasActiveTask: boolean;

  fetchAndApplyResult: (
    taskId: string | null,
    expectedState: 'successful' | 'failed',
  ) => Promise<void>;
  lastFetchedRef: React.MutableRefObject<{ taskId: string | null; state: string | null }>;

  hydrateFromServer: () => Promise<void>;
  hydrationState: HydrationState;

  clearResults: (options?: ClearAnalysisUiOptions) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAnalysisFeature<TResult = unknown>(
  config: UseAnalysisFeatureConfig<TResult>,
): UseAnalysisFeatureReturn {
  const queryClient = useQueryClient();

  // Keep a ref to the full config so memoised callbacks always see latest values
  const configRef = useRef(config);
  useEffect(() => {
    configRef.current = config;
  }, [config]);

  // ---- Task ID ----
  const [localTaskId, setLocalTaskId] = useState<string | null>(null);
  const localTaskIdRef = useRef<string | null>(null);
  useEffect(() => {
    localTaskIdRef.current = localTaskId;
  }, [localTaskId]);

  // ---- Running state ----
  const [isRunning, setIsRunningState] = useState(false);
  const runningRef = useRef(false);
  // Identity stability: used in useEffect dependency array
  const setIsRunning = useCallback((value: boolean) => {
    setIsRunningState(value);
    runningRef.current = value;
  }, []);

  // ---- Dedup refs ----
  const lastFetchedRef = useRef<{ taskId: string | null; state: string | null }>({
    taskId: null,
    state: null,
  });
  const fetchingTaskIdRef = useRef<string | null>(null);

  // ---- Workspace change cleanup ----
  useEffect(() => {
    lastFetchedRef.current = { taskId: null, state: null };
    Promise.resolve().then(() => setLocalTaskId(null));
  }, [config.workspaceId]);

  // Returns the cached server-lock data (fetched once by useAnalysisServerRequestLock).
  // Used to avoid refetching /current and /request during hydration.
  const readServerLockCache = useCallback((): CachedServerLock | null => {
    if (!configRef.current.workspaceId) return null;
    return queryClient.getQueryData<CachedServerLock>(
      analysisServerRequestLockQueryKey(
        configRef.current.analysisType,
        configRef.current.workspaceId,
      ),
    ) ?? null;
  }, [queryClient]);

  // Invalidate the server-lock query only when the local task id truly diverges
  // from the cached currentTaskId. Previously this fired on every localTaskId
  // change (including ones produced by hydration itself), doubling /current
  // and /request traffic.
  useEffect(() => {
    if (!localTaskId || !config.workspaceId) return;
    const cached = readServerLockCache();
    if (cached && cached.currentTaskId === localTaskId) return;
    void queryClient.invalidateQueries({
      queryKey: analysisServerRequestLockQueryKey(config.analysisType, config.workspaceId),
    });
  }, [localTaskId, config.workspaceId, config.analysisType, queryClient, readServerLockCache]);

  // ---- Task status ref (for async access inside resolveTaskId) ----
  const taskStatusRef = useRef<AnalysisTaskStatus | null>(null);

  // ---- Task ID resolution ----
  // Prefers, in order: locally-tracked ID → cached result metadata → cached
  // server-lock currentTaskId (populated by useAnalysisServerRequestLock) →
  // in-memory task-flow status → caller-supplied extras → network /current.
  // The server-lock cache check means we almost never need to hit /current
  // on hydration because the lock query fires on mount.
  const resolveTaskId = async (): Promise<string | null> => {
    const cfg = configRef.current;
    if (!cfg.workspaceId) return null;

    const metadataTaskId =
      (cfg.resultRef.current as AnalysisResultLike)?.metadata?.task_id ?? null;
    const status = taskStatusRef.current;
    const extra = cfg.getExtraTaskIdCandidates?.() ?? [];
    const cachedLock = readServerLockCache();

    return resolveAnalysisTaskId({
      candidateIds: [
        localTaskIdRef.current,
        metadataTaskId,
        cachedLock?.currentTaskId ?? null,
        status?.activeTaskId,
        status?.runningTask?.task_id,
        status?.queuedTask?.task_id,
        status?.terminalTask?.task_id,
        ...extra,
      ],
      fetchCurrentTaskId: async () => {
        const headers = cfg.getAuthHeaders();
        const current = (await textApi.getAnalysisCurrent(
          cfg.analysisType,
          headers,
        )) as Record<string, unknown>;
        const raw = Array.isArray(current?.task_ids)
          ? (current.task_ids as string[])[0]
          : null;
        return typeof raw === 'string' && raw.trim().length > 0 ? raw : null;
      },
      onResolved: setLocalTaskId,
    });
  }; // stable — uses refs internally

  // Fetches a task result, deduped against concurrent fetches (from either
  // hydration or the task-flow terminal-refresh) and against identical
  // already-applied results. Also updates lastFetchedRef + isRunning.
  const fetchAndApplyResult = async (
      taskId: string | null,
      expectedState: 'successful' | 'failed',
    ): Promise<void> => {
      const cfg = configRef.current;
      if (!cfg.isTabActive || !cfg.workspaceId) {
        return;
      }

      const resolvedTaskId = taskId ?? (await resolveTaskId());
      if (!resolvedTaskId) {
        return;
      }

      if (fetchingTaskIdRef.current === resolvedTaskId) {
        return;
      }
      if (
        lastFetchedRef.current.taskId === resolvedTaskId &&
        lastFetchedRef.current.state === expectedState
      ) {
        return;
      }

      try {
        fetchingTaskIdRef.current = resolvedTaskId;
        const headers = cfg.getAuthHeaders();
        const result = await cfg.fetchResult(resolvedTaskId, headers);
        if (!result) {
          return;
        }

        cfg.onResultFetched(result, resolvedTaskId);

        const state = (result as AnalysisResultLike)?.state as string | undefined;
        if (state === 'successful' || state === 'failed') {
          setIsRunning(false);
          lastFetchedRef.current = { taskId: resolvedTaskId, state };
        }
      } finally {
        fetchingTaskIdRef.current = null;
      }
    };

  // ---- Task flow refresh callback (wired into useAnalysisTaskFlow) ----
  const handleTaskRefresh = async (context: AnalysisTaskFlowRefreshContext): Promise<void> => {
      if (context.reason !== 'terminal') return;
      if (!configRef.current.isTabActive) return;
      if (context.taskState !== 'successful' && context.taskState !== 'failed') return;
      await fetchAndApplyResult(
        context.taskId ?? null,
        context.taskState as 'successful' | 'failed',
      );
    };

  // ---- Fallback banner ----
  const fallbackRunningBanner = (status: AnalysisTaskStatus) => {
      const cfg = configRef.current;
      const resultRunning = cfg.isResultRunning
        ? cfg.isResultRunning(cfg.resultRef.current)
        : (cfg.resultRef.current as AnalysisResultLike)?.state === 'running';

      if (!resultRunning) return null;

      return {
        taskId:
          (cfg.resultRef.current as AnalysisResultLike)?.metadata?.task_id ??
          status.activeTaskId ??
          null,
        message: status.bannerMessage?.trim() || undefined,
      };
    };

  // ---- Task flow ----
  const {
    status: taskStatus,
    banner,
    hasActiveTask,
  } = useAnalysisTaskFlow({
    taskType: config.taskType,
    isTabActive: config.isTabActive,
    workspaceId: config.workspaceId,
    manualActiveTaskId: localTaskId,
    fallbackRunningBanner,
    refreshResults: handleTaskRefresh,
  });

  // Keep task status accessible to resolveTaskId
  useEffect(() => {
    taskStatusRef.current = taskStatus;
  }, [taskStatus]);

  // ---- Sync isRunning with task status ----
  useEffect(() => {
    if (!taskStatus.tasks.length) {
      if (runningRef.current) setIsRunning(false);
      return;
    }
    if (taskStatus.runningTask) {
      if (!runningRef.current) setIsRunning(true);
    } else if (runningRef.current) {
      setIsRunning(false);
    }
  }, [taskStatus.tasks, taskStatus.runningTask, setIsRunning]);

  // ---- Hydration ----
  // `fetchRequest` and `fetchResult` below are deliberately cache-aware:
  // - `fetchRequest` returns the serverRequest already fetched by
  //   useAnalysisServerRequestLock (same endpoint, same task id) instead of
  //   hitting the network a second time.
  // - `fetchResult` shares fetchingTaskIdRef/lastFetchedRef with
  //   fetchAndApplyResult so a terminal-refresh + hydration racing for the
  //   same task id only produces one /result request.
  const { hydrateFromServer, hydrationState } = useAnalysisHydration({
    workspaceId: config.workspaceId,
    analysisKey: config.analysisType,
    getAuthHeaders: config.getAuthHeaders,
    resolveTaskId,
    onTaskIdResolved: setLocalTaskId,
    fetchRequest: config.fetchRequest
      ? async (taskId) => {
          if (!taskId) return null;
          const cached = readServerLockCache();
          if (cached && cached.currentTaskId === taskId && cached.serverRequest) {
            return cached.serverRequest;
          }
          return (
            configRef.current.fetchRequest?.(
              taskId,
              configRef.current.getAuthHeaders(),
            ) ?? null
          );
        }
      : undefined,
    fetchResult: async (taskId) => {
      if (!taskId) return null;
      if (fetchingTaskIdRef.current === taskId) return null;
      const last = lastFetchedRef.current;
      if (last.taskId === taskId && (last.state === 'successful' || last.state === 'failed')) {
        return null;
      }
      fetchingTaskIdRef.current = taskId;
      try {
        return await configRef.current.fetchResult(
          taskId,
          configRef.current.getAuthHeaders(),
        );
      } finally {
        fetchingTaskIdRef.current = null;
      }
    },
    applyRequest: config.onHydratedRequest
      ? (request: unknown | null | undefined) =>
          configRef.current.onHydratedRequest?.(request ?? null)
      : undefined,
    applyResult: config.onHydratedResult
      ? (result: TResult | null | undefined) =>
          configRef.current.onHydratedResult?.(result ?? null)
      : undefined,
  });

  // Gate: hydrate exactly once per workspace per tab activation
  const hydratedOnceRef = useRef(false);

  useEffect(() => {
    hydratedOnceRef.current = false;
  }, [config.workspaceId]);

  useEffect(() => {
    if (!config.isTabActive || !config.workspaceId || hydratedOnceRef.current) return;
    hydratedOnceRef.current = true;
    void hydrateFromServer().then(() => {
      // Update dedup ref so fetchAndApplyResult won't re-fetch what hydration already loaded
      const result = configRef.current.resultRef.current as AnalysisResultLike | null;
      const state = result?.state as string | undefined;
      const taskId = result?.metadata?.task_id as string | undefined;
      if (taskId && (state === 'successful' || state === 'failed')) {
        lastFetchedRef.current = { taskId, state };
      }
    });
  }, [config.isTabActive, config.workspaceId, hydrateFromServer]);

  // ---- Clear ----
  const clearResults = async (options?: ClearAnalysisUiOptions): Promise<void> => {
    const cfg = configRef.current;
    if (!cfg.workspaceId) return;

    const status = taskStatusRef.current;
    const extraSources = cfg.getClearTaskIdSources?.() ?? [];

    await clearAnalysis({
      analysisType: cfg.analysisType,
      workspaceId: cfg.workspaceId,
      queryClient,
      taskIdSources: [
        localTaskIdRef.current,
        (cfg.resultRef.current as AnalysisResultLike)?.metadata?.task_id,
        status?.activeTaskId,
        status?.runningTask?.task_id,
        status?.successfulTask?.task_id,
        status?.failedTask?.task_id,
        ...extraSources,
      ],
      resolveTaskId,
      getAuthHeaders: cfg.getAuthHeaders,
      onCleanup: (taskIds) => {
        setLocalTaskId(null);
        lastFetchedRef.current = { taskId: null, state: null };
        setIsRunning(false);
        cfg.pruneGlobalTasks?.(taskIds);
        cfg.onCleared(taskIds, options);
      },
    });
  };

  return {
    localTaskId,
    setLocalTaskId,
    resolveTaskId,
    isRunning,
    setIsRunning,
    runningRef,
    taskStatus,
    banner,
    hasActiveTask,
    fetchAndApplyResult,
    lastFetchedRef,
    hydrateFromServer,
    hydrationState,
    clearResults,
  };
}
