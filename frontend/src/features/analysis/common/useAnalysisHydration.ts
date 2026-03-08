import { useCallback, useEffect, useRef, useState } from 'react';
import { clampDisplayTokenLimit } from './utils';
import { textApi } from '@/api/text';

export type HydrationStatus = 'idle' | 'loading' | 'error';

export interface HydrationState {
  status: HydrationStatus;
  error?: string;
  lastHydratedAt?: number;
}

type MaybePromise<T> = T | Promise<T>;

type Nullable<T> = T | null | undefined;

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
  autoHydrateOnFocus?: boolean;
  autoHydrateOnVisibility?: boolean;
  onHydrationError?: (error: unknown) => void;
}

export interface UseAnalysisHydrationReturn<TPreferences> {
  hydrateFromServer: () => Promise<void>;
  hydrationState: HydrationState;
  persistPreferences: (partial: TPreferences) => Promise<void>;
}

const isBrowser = typeof window !== 'undefined';

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
    autoHydrateOnFocus = true,
    autoHydrateOnVisibility = true,
    onHydrationError,
  } = config;

  const [hydrationState, setHydrationState] = useState<HydrationState>({ status: 'idle' });
  const inflightRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    setHydrationState({ status: 'idle' });
    inflightRef.current = null;
  }, [workspaceId]);

  // Identity stability: used in useEffect dependency array and returned from hook
  const hydrateFromServer = useCallback(async () => {
    if (!workspaceId || inflightRef.current) {
      return inflightRef.current ?? Promise.resolve();
    }

    const inflight = (async () => {
      setHydrationState((prev) => ({ ...prev, status: 'loading', error: undefined }));
      try {
        let taskId: string | null = null;
        if (resolveTaskId) {
          taskId = await resolveTaskId();
        } else if (analysisKey && getAuthHeaders && workspaceId) {
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
          setHydrationState({ status: 'idle', lastHydratedAt: Date.now() });
          return;
        }

        const requestPromise = fetchRequest
          ? Promise.resolve(fetchRequest(taskId)).catch((error) => {
              console.error('Analysis hydration request fetch failed', error);
              return null;
            })
          : Promise.resolve(null);
        const resultPromise = fetchResult
          ? Promise.resolve(fetchResult(taskId)).catch((error) => {
              console.error('Analysis hydration result fetch failed', error);
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

        setHydrationState({ status: 'idle', lastHydratedAt: Date.now() });
      } catch (error) {
        console.error('Analysis hydration failed', error);
        setHydrationState({ status: 'error', error: error instanceof Error ? error.message : 'Unknown error' });
        onHydrationError?.(error);
      } finally {
        inflightRef.current = null;
      }
    })();

    inflightRef.current = inflight;
    await inflight;
  }, [workspaceId, resolveTaskId, analysisKey, getAuthHeaders, onTaskIdResolved, fetchRequest, fetchResult, applyRequest, applyResult, onHydrationError]);

  useEffect(() => {
    if (!isBrowser || !workspaceId) return;

    const handleFocus = () => {
      if (!autoHydrateOnFocus) return;
      void hydrateFromServer();
    };

    const handleVisibility = () => {
      if (!autoHydrateOnVisibility) return;
      if (document.visibilityState === 'visible') {
        void hydrateFromServer();
      }
    };

    if (autoHydrateOnFocus) {
      window.addEventListener('focus', handleFocus);
    }
    if (autoHydrateOnVisibility) {
      document.addEventListener('visibilitychange', handleVisibility);
    }

    return () => {
      if (autoHydrateOnFocus) {
        window.removeEventListener('focus', handleFocus);
      }
      if (autoHydrateOnVisibility) {
        document.removeEventListener('visibilitychange', handleVisibility);
      }
    };
  }, [workspaceId, autoHydrateOnFocus, autoHydrateOnVisibility, hydrateFromServer]);

  const persistPreferencesSafe = async (partial: TPreferences) => {
      if (!persistPreferences || !workspaceId || !partial) return;
      const normalized = normalizePreferencePayload(partial);
      await persistPreferences(normalized);
    };

  return ({
      hydrateFromServer,
      hydrationState,
      persistPreferences: persistPreferencesSafe,
    });
}
