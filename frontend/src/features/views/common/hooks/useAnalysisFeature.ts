import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { cancelTask } from '@/api';
import { collectTaskIds, resolveAnalysisTaskId } from '@/features/views/common/analysisTaskUtils';
import { useAnalysisHydration, type HydrationState } from '../useAnalysisHydration';
import { clearAnalysis } from '../clearAnalysis';
import { useAnalysisTaskFlow } from '../tasks/useAnalysisTaskFlow';
import type {
  AnalysisTaskBannerState,
  AnalysisTaskFlowRefreshContext,
  CanonicalAnalysisTaskType,
} from '../tasks/types';
import { lastRunRequestQueryKey, type LastRunAnalysisType } from './useLastRunRequest';
import type { AnalysisTaskStatus } from '@/features/views/common/useAnalysisTaskStatus';

interface CachedLastRunRequest {
  hasServerRequest: boolean;
  taskId: string | null;
  serverRequest: Record<string, unknown> | null;
}

/** Minimal shape for accessing common result fields via type assertion */
interface AnalysisResultLike {
  state?: string;
  metadata?: { task_id?: string };
}

/**
 * A tabbed analysis feature explicitly owns its task id through
 * `hydrationTaskId`. When that prop is present but null, the tab has not run
 * yet and must not fall back to the workspace's global current/terminal task.
 */
const hasTabOwnedTaskId = (config: object): boolean =>
  Object.prototype.hasOwnProperty.call(config, 'hydrationTaskId');

export interface ClearAnalysisUiOptions {
  preserveLocalState?: boolean;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

interface UseAnalysisFeatureConfig<TResult = unknown> {
  analysisType: LastRunAnalysisType;
  taskType: CanonicalAnalysisTaskType | (string & {});
  workspaceId: string | null;
  isTabActive: boolean;

  /** Ref to feature-managed result state — hook reads for banner / clear logic */
  resultRef: { current: TResult | null };

  /** Fetch a task's result from the backend */
  fetchResult: (taskId: string) => Promise<TResult | null>;
  /** Optionally fetch a task's request payload (used during hydration) */
  fetchRequest?: (taskId: string) => Promise<unknown>;

  /** Called when a terminal task result is fetched */
  onResultFetched: (result: TResult, taskId: string) => void;
  /** Called during hydration with the server result */
  onHydratedResult?: (result: TResult | null) => void | Promise<void>;
  /** Called during hydration with the server request */
  onHydratedRequest?: (request: unknown) => void | Promise<void>;
  /** Called after the clear lifecycle completes */
  onCleared: (clearedTaskIds: string[], options?: ClearAnalysisUiOptions) => void;

  /**
   * Optional callback to prune global task store entries for the cleared task IDs.
   * When provided, called automatically during clear — features don't need to
   * duplicate the pruneTasksById boilerplate in their onCleared.
   */
  pruneGlobalTasks?: (taskIds: string[]) => void;

  /** Extra task ID candidates for resolution beyond the built-in sources */
  getExtraTaskIdCandidates?: () => (string | null | undefined)[];
  /** Extra task ID sources used only during clear */
  getClearTaskIdSources?: () => (string | null | undefined)[];
  /** Custom check for whether the result indicates a running state (default: result.state === 'running') */
  isResultRunning?: (result: TResult | null) => boolean;

  /**
   * Task id supplied by an external owner (e.g. the active analysis tab) that
   * must win task resolution deterministically. Prepended as the first task-id
   * candidate so it survives the workspace-change ``localTaskId`` reset race —
   * the tab record, not transient local state, drives which task hydrates.
   * Callers without tabs pass undefined/null, which ``resolveAnalysisTaskId``
   * skips, preserving existing behaviour.
   */
  hydrationTaskId?: string | null;
}

// ---------------------------------------------------------------------------
// Return
// ---------------------------------------------------------------------------

interface UseAnalysisFeatureReturn {
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
  clearResults: (options?: ClearAnalysisUiOptions) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Owns the common task lifecycle for analysis tabs: task id discovery, status
 * banners, hydration, stopping, result refresh, and clear/reset coordination.
 * Used by: task-backed analysis feature screens.
 * Flow: resolve task identity and cached request state, then coordinate hydration, terminal refresh, cancellation, and clear callbacks.
 */
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
  const [isStopping, setIsStopping] = useState(false);
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
    void Promise.resolve().then(() => {
      setLocalTaskId(null);
    });
  }, [config.workspaceId]);

  // Returns the cached last-run request data (fetched once by useLastRunRequest).
  // Used to avoid refetching /current and /request during hydration.
  const readLastRunRequestCache = useCallback(
    (taskId?: string | null): CachedLastRunRequest | null => {
      if (!configRef.current.workspaceId) return null;
      return (
        queryClient.getQueryData<CachedLastRunRequest>(
          lastRunRequestQueryKey(
            configRef.current.analysisType,
            configRef.current.workspaceId,
            taskId,
          ),
        ) ?? null
      );
    },
    [queryClient],
  );

  // Invalidate the last-run request query only when the local task id truly diverges
  // from the cached taskId. Previously this fired on every localTaskId
  // change (including ones produced by hydration itself), doubling /current
  // and /request traffic.
  useEffect(() => {
    if (!localTaskId || !config.workspaceId) return;
    const cached = readLastRunRequestCache(localTaskId);
    if (cached?.taskId === localTaskId) return;
    void queryClient.invalidateQueries({
      queryKey: lastRunRequestQueryKey(config.analysisType, config.workspaceId),
    });
  }, [localTaskId, config.workspaceId, config.analysisType, queryClient, readLastRunRequestCache]);

  // ---- Task status ref (for async access inside resolveTaskId) ----
  const taskStatusRef = useRef<AnalysisTaskStatus | null>(null);

  // ---- Task ID resolution ----
  // Prefers, in order: locally-tracked ID → cached result metadata → cached
  // last-run request taskId (populated by useLastRunRequest) →
  // in-memory task-flow status → caller-supplied extras.
  /**
   * Resolves the task id from explicit local/tab-owned sources, then records
   * the winning id for future clears.
   * Called by: hydration, terminal result refresh, clear, and stop workflows.
   * Flow: collect task-id candidates from refs, result metadata, last-run request cache, task status, and caller extras; then cache the resolved id.
   */
  const resolveTaskId = (): Promise<string | null> => {
    const cfg = configRef.current;
    if (!cfg.workspaceId) return Promise.resolve(null);

    const metadataTaskId =
      (cfg.resultRef.current as AnalysisResultLike | null)?.metadata?.task_id ?? null;
    const status = taskStatusRef.current;
    const extra = cfg.getExtraTaskIdCandidates?.() ?? [];
    const cachedLastRun = readLastRunRequestCache(cfg.hydrationTaskId ?? localTaskIdRef.current);
    const isTabOwnedTask = hasTabOwnedTaskId(cfg);
    const statusCandidates = isTabOwnedTask
      ? []
      : [
          status?.activeTaskId,
          status?.runningTask?.task_id,
          status?.queuedTask?.task_id,
          status?.terminalTask?.task_id,
        ];

    return Promise.resolve(
      resolveAnalysisTaskId({
        candidateIds: [
          cfg.hydrationTaskId ?? null,
          localTaskIdRef.current,
          metadataTaskId,
          cachedLastRun?.taskId ?? null,
          ...statusCandidates,
          ...extra,
        ],
        onResolved: setLocalTaskId,
      }),
    );
  }; // stable — uses refs internally

  // Fetches a task result, deduped against concurrent fetches (from either
  // hydration or the task-flow terminal-refresh) and against identical
  // already-applied results. Also updates lastFetchedRef + isRunning.
  /**
   * Fetches and applies terminal results for task-flow refreshes while sharing
   * de-dupe refs with hydration so one task id only produces one result update.
   * Called by: `handleTaskRefresh` when the owned task reaches a terminal state.
   * Flow: reject inactive, foreign, or duplicate tasks; resolve the owned id;
   * fetch and apply the result; then synchronize running and de-dupe refs.
   */
  const fetchAndApplyResult = async (
    taskId: string | null,
    expectedState: 'successful' | 'failed',
  ): Promise<void> => {
    const cfg = configRef.current;
    if (!cfg.isTabActive || !cfg.workspaceId) {
      return;
    }

    const isTabOwnedTask = hasTabOwnedTaskId(cfg);
    const ownedTaskIds = collectTaskIds([
      cfg.hydrationTaskId,
      localTaskIdRef.current,
      (cfg.resultRef.current as AnalysisResultLike | null)?.metadata?.task_id,
      ...(cfg.getExtraTaskIdCandidates?.() ?? []),
    ]);
    if (isTabOwnedTask && taskId && !ownedTaskIds.includes(taskId)) {
      return;
    }

    const resolvedTaskId = taskId ?? (await resolveTaskId());
    if (!resolvedTaskId) {
      return;
    }
    if (isTabOwnedTask && !ownedTaskIds.includes(resolvedTaskId)) {
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
      const result = await cfg.fetchResult(resolvedTaskId);
      if (!result) {
        return;
      }

      cfg.onResultFetched(result, resolvedTaskId);

      const state = (result as AnalysisResultLike | null)?.state;
      if (state === 'successful' || state === 'failed') {
        setIsRunning(false);
        lastFetchedRef.current = { taskId: resolvedTaskId, state };
      }
    } finally {
      fetchingTaskIdRef.current = null;
    }
  };

  // ---- Task flow refresh callback (wired into useAnalysisTaskFlow) ----
  /**
   * Bridges task-store terminal events into feature-specific result refreshes
   * only for active tabs and successful/failed terminal states.
   * Called by: useAnalysisTaskFlow when the tracked task reaches terminal state.
   */
  const handleTaskRefresh = async (context: AnalysisTaskFlowRefreshContext): Promise<void> => {
    if (!configRef.current.isTabActive) return;
    if (context.taskState !== 'successful' && context.taskState !== 'failed') return;
    await fetchAndApplyResult(context.taskId ?? null, context.taskState);
  };

  // ---- Fallback banner ----
  /**
   * Builds a running banner from a feature's cached result when task-store state
   * has not yet observed the same task, keeping restored tasks visible on load.
   * Called by: useAnalysisTaskFlow while deriving the banner fallback.
   * Flow: confirm the cached result is running, then derive its task id and
   * optional message from cached metadata plus current task status.
   */
  const fallbackRunningBanner = (status: AnalysisTaskStatus) => {
    const cfg = configRef.current;
    const resultRunning = cfg.isResultRunning
      ? cfg.isResultRunning(cfg.resultRef.current)
      : (cfg.resultRef.current as AnalysisResultLike | null)?.state === 'running';

    if (!resultRunning) return null;

    return {
      taskId:
        (cfg.resultRef.current as AnalysisResultLike | null)?.metadata?.task_id ??
        status.activeTaskId ??
        null,
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- empty trimmed message should collapse to undefined (no banner message)
      message: status.bannerMessage?.trim() || undefined,
    };
  };

  const ownedTaskIds = hasTabOwnedTaskId(config)
    ? collectTaskIds([config.hydrationTaskId, localTaskId])
    : undefined;

  // ---- Task flow ----
  const { status: taskStatus, banner } = useAnalysisTaskFlow({
    taskType: config.taskType,
    isTabActive: config.isTabActive,
    workspaceId: config.workspaceId,
    taskIds: ownedTaskIds,
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
  //   useLastRunRequest (same endpoint, same task id) instead of
  //   hitting the network a second time.
  // - `fetchResult` shares fetchingTaskIdRef/lastFetchedRef with
  //   fetchAndApplyResult so a terminal-refresh + hydration racing for the
  //   same task id only produces one /result request.
  const { hydrateFromServer, hydrationState } = useAnalysisHydration({
    workspaceId: config.workspaceId,
    resolveTaskId,
    onTaskIdResolved: setLocalTaskId,
    fetchRequest: config.fetchRequest
      ? async (taskId) => {
          if (!taskId) return null;
          const cached = readLastRunRequestCache(taskId);
          if (cached?.taskId === taskId && cached.serverRequest) {
            return cached.serverRequest;
          }
          return configRef.current.fetchRequest?.(taskId) ?? null;
        }
      : undefined,
    /**
     * Shares result fetching with terminal refreshes so hydration does not repeat
     * a result already applied for the same successful or failed task.
     * Called by: useAnalysisHydration when loading persisted task results.
     * Flow: skip blank, duplicate, or already terminal task ids, call the feature result fetcher, then release the in-flight guard.
     */
    fetchResult: async (taskId) => {
      if (!taskId) return null;
      if (fetchingTaskIdRef.current === taskId) return null;
      const last = lastFetchedRef.current;
      if (last.taskId === taskId && (last.state === 'successful' || last.state === 'failed')) {
        return null;
      }
      fetchingTaskIdRef.current = taskId;
      try {
        return await configRef.current.fetchResult(taskId);
      } finally {
        fetchingTaskIdRef.current = null;
      }
    },
    applyRequest: config.onHydratedRequest
      ? (request: unknown) => configRef.current.onHydratedRequest?.(request ?? null)
      : undefined,
    applyResult: config.onHydratedResult
      ? (result: TResult | null | undefined) => configRef.current.onHydratedResult?.(result ?? null)
      : undefined,
  });

  // Gate: hydrate exactly once per workspace per tab activation
  const hydratedOnceRef = useRef(false);

  useEffect(() => {
    hydratedOnceRef.current = false;
  }, [config.workspaceId, config.hydrationTaskId]);

  useEffect(() => {
    if (!config.isTabActive || !config.workspaceId || hydratedOnceRef.current) return;
    hydratedOnceRef.current = true;
    void hydrateFromServer().then(() => {
      // Update dedup ref so fetchAndApplyResult won't re-fetch what hydration already loaded
      const result = configRef.current.resultRef.current as AnalysisResultLike | null;
      const state = result?.state;
      const taskId = result?.metadata?.task_id;
      if (taskId && (state === 'successful' || state === 'failed')) {
        lastFetchedRef.current = { taskId, state };
      }
    });
  }, [config.isTabActive, config.workspaceId, config.hydrationTaskId, hydrateFromServer]);

  // ---- Clear ----
  /**
   * Clears backend task records and every local source of task/result state so
   * feature panels can start a new analysis from an unlocked baseline.
   * Called by: analysis feature clear buttons and task banner cleanup flows.
   * Flow: collect local/result/status task ids, call clearAnalysis with cleanup hooks, then clear local ids, fetch markers, running state, global tasks, and feature results.
   */
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
        (cfg.resultRef.current as AnalysisResultLike | null)?.metadata?.task_id,
        status?.activeTaskId,
        status?.runningTask?.task_id,
        status?.successfulTask?.task_id,
        status?.failedTask?.task_id,
        ...extraSources,
      ],
      resolveTaskId,
      /** Called by: clearAnalysis after backend task-cache cleanup completes. */
      onCleanup: (taskIds) => {
        setLocalTaskId(null);
        lastFetchedRef.current = { taskId: null, state: null };
        setIsRunning(false);
        cfg.pruneGlobalTasks?.(taskIds);
        cfg.onCleared(taskIds, options);
      },
    });
  };

  /**
   * Cancels the best-known running task id for features whose long-running
   * backend jobs can be stopped from the shared analysis banner.
   * Called by: analysis running banners through the hook return value.
   * Flow: choose the running/active/local/result task id, send the generated cancel request, then update stopping and running flags around failures.
   */
  const stopTask = async (): Promise<void> => {
    const cfg = configRef.current;
    if (!cfg.workspaceId) return;

    const status = taskStatusRef.current;
    const taskIds = collectTaskIds([
      status?.runningTask?.task_id,
      status?.activeTaskId,
      localTaskIdRef.current,
      (cfg.resultRef.current as AnalysisResultLike | null)?.metadata?.task_id,
    ]);
    const taskId = taskIds[0] ?? (await resolveTaskId());
    if (!taskId) return;

    setIsStopping(true);
    try {
      await cancelTask({
        path: { task_id: taskId },
        throwOnError: true,
      });
      setIsRunning(false);
    } catch (error) {
      console.warn(`[${cfg.analysisType}] Failed to stop task ${taskId}:`, error);
    } finally {
      setIsStopping(false);
    }
  };

  return {
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
