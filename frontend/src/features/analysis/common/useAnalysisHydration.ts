import { useCallback, useRef, useState } from 'react';
import { clampDisplayTokenLimit } from './utils';
import { textApi } from '@/lib/backend/text';
import { isNetworkError } from '@/lib/apiError';

/**
 * Hydration is opportunistic — failures leave the feature in its empty
 * "no prior task to restore" state, which is recoverable. Network errors
 * (backend restarting, offline) get logged at debug; real server errors
 * stay at warn so they remain visible without being shouty.
 */
const logHydrationFailure = (label: string, error: unknown) => {
  const fn = isNetworkError(error) ? console.debug : console.warn;
  fn(`[analysis-hydration] ${label}:`, error);
};

export type HydrationStatus = 'idle' | 'loading' | 'error';

export interface HydrationState {
  status: HydrationStatus;
  error?: string;
  lastHydratedAt?: number;
}

type HydrationInternalState = HydrationState & { workspaceId?: string | null };

interface InflightHydration {
  workspaceId: string;
  promise: Promise<void>;
}

type MaybePromise<T> = T | Promise<T>;

type Nullable<T> = T | null | undefined;

const toHydrationState = ({ workspaceId: _workspaceId, ...state }: HydrationInternalState): HydrationState => state;

export interface UseAnalysisHydrationConfig<TRequest, TResult, TPreferences> {
  workspaceId?: string | null;
  analysisKey?: string;
  getAuthHeaders?: () => Record<string, string>;
  resolveTaskId?: () => MaybePromise<string | null>;
  onTaskIdResolved?: (taskId: string | null) => void;
  fetchRequest?: (taskId?: string | null) => MaybePromise<Nullable<TRequest>>;
  fetchResult?: (taskId?: string | null) => MaybePromise<Nullable<TResult>>;
  applyRequest?: (request: Nullable<TRequest>) => MaybePromise<void>;
  applyResult?: (result: Nullable<TResult>) => MaybePromise<void>;
  persistPreferences?: (partial: TPreferences) => MaybePromise<void>;
  onHydrationError?: (error: unknown) => void;
}

export interface UseAnalysisHydrationReturn<TPreferences> {
  hydrateFromServer: () => Promise<void>;
  hydrationState: HydrationState;
  persistPreferences: (partial: TPreferences) => Promise<void>;
}

const normalizePreferencePayload = <TPreferences extends Record<string, unknown>>(
  partial: TPreferences
): TPreferences => {
  if (!partial) return partial;
  const normalized: Record<string, unknown> = { ...partial };

  if (typeof normalized.token_limit === 'number') {
    normalized.token_limit = clampDisplayTokenLimit(normalized.token_limit).limit;
  } else if (typeof normalized.tokenLimit === 'number') {
    normalized.token_limit = clampDisplayTokenLimit(normalized.tokenLimit).limit;
    delete normalized.tokenLimit;
  }

  if (Array.isArray(normalized.stopWords) && !normalized.stop_words) {
    normalized.stop_words = normalized.stopWords;
    delete normalized.stopWords;
  }

  return normalized as TPreferences;
};

export function useAnalysisHydration<TRequest = unknown, TResult = unknown, TPreferences extends Record<string, unknown> = Record<string, unknown>>(
  config: UseAnalysisHydrationConfig<TRequest, TResult, TPreferences>
): UseAnalysisHydrationReturn<TPreferences> {
  const {
    workspaceId,
    analysisKey,
    getAuthHeaders,
    resolveTaskId,
    onTaskIdResolved,
    fetchRequest,
    fetchResult,
    applyRequest,
    applyResult,
    persistPreferences,
    onHydrationError,
  } = config;

  const [internalHydrationState, setHydrationState] = useState<HydrationInternalState>({ status: 'idle', workspaceId });
  const inflightRef = useRef<InflightHydration | null>(null);
  const hydrationState: HydrationState = internalHydrationState.workspaceId === workspaceId
    ? toHydrationState(internalHydrationState)
    : { status: 'idle' };

  // Identity stability: used in useEffect dependency array and returned from hook
  const hydrateFromServer = useCallback(async () => {
    const activeWorkspaceId = workspaceId;
    if (!activeWorkspaceId) {
      return Promise.resolve();
    }

    if (inflightRef.current?.workspaceId === activeWorkspaceId) {
      return inflightRef.current.promise;
    }

    const inflight = (async () => {
      setHydrationState((prev) => ({ ...prev, workspaceId: activeWorkspaceId, status: 'loading', error: undefined }));
      try {
        let taskId: string | null = null;
        if (resolveTaskId) {
          taskId = await resolveTaskId();
        } else if (analysisKey && getAuthHeaders) {
          try {
            const current = await textApi.getAnalysisCurrent(analysisKey, getAuthHeaders()) as Record<string, unknown>;
            const currentTaskId = Array.isArray(current?.task_ids) ? current.task_ids[0] : null;
            taskId = typeof currentTaskId === 'string' && currentTaskId.trim().length > 0 ? currentTaskId : null;
          } catch {
            taskId = null;
          }
        }

        onTaskIdResolved?.(taskId ?? null);

        if (!taskId) {
          setHydrationState({ status: 'idle', lastHydratedAt: Date.now(), workspaceId: activeWorkspaceId });
          return;
        }

        const requestPromise = fetchRequest
          ? Promise.resolve(fetchRequest(taskId)).catch((error) => {
              logHydrationFailure('request fetch failed', error);
              return null;
            })
          : Promise.resolve(null);
        const resultPromise = fetchResult
          ? Promise.resolve(fetchResult(taskId)).catch((error) => {
              logHydrationFailure('result fetch failed', error);
              return null;
            })
          : Promise.resolve(null);

        const applyRequestPromise = applyRequest
          ? requestPromise.then((payload) => applyRequest(payload ?? null))
          : Promise.resolve();
        const applyResultPromise = applyResult
          ? resultPromise.then((payload) => applyResult(payload ?? null))
          : Promise.resolve();

        await Promise.allSettled([applyRequestPromise, applyResultPromise]);

        setHydrationState({ status: 'idle', lastHydratedAt: Date.now(), workspaceId: activeWorkspaceId });
      } catch (error) {
        logHydrationFailure('hydration failed', error);
        setHydrationState({ status: 'error', error: error instanceof Error ? error.message : 'Unknown error', workspaceId: activeWorkspaceId });
        onHydrationError?.(error);
      } finally {
        if (inflightRef.current?.workspaceId === activeWorkspaceId) {
          inflightRef.current = null;
        }
      }
    })();

    inflightRef.current = { workspaceId: activeWorkspaceId, promise: inflight };
    await inflight;
  }, [workspaceId, resolveTaskId, analysisKey, getAuthHeaders, onTaskIdResolved, fetchRequest, fetchResult, applyRequest, applyResult, onHydrationError]);

  const persistPreferencesSafe = async (partial: TPreferences) => {
    if (!persistPreferences || !workspaceId || !partial) return;
    const normalized = normalizePreferencePayload(partial);
    await persistPreferences(normalized);
  };

  return {
    hydrateFromServer,
    hydrationState,
    persistPreferences: persistPreferencesSafe,
  };
}
