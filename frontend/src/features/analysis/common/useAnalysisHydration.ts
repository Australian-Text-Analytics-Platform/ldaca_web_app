import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clampDisplayTokenLimit } from './utils';

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
  fetchRequest?: () => MaybePromise<Nullable<TRequest>>;
  fetchResult?: () => MaybePromise<Nullable<TResult>>;
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

  if (Array.isArray((normalized as any).stopWords) && !normalized.stop_words) {
    normalized.stop_words = (normalized as any).stopWords;
    delete normalized.stopWords;
  }

  return normalized as TPreferences;
};

export function useAnalysisHydration<TRequest = unknown, TResult = unknown, TPreferences extends Record<string, unknown> = Record<string, unknown>>(
  config: UseAnalysisHydrationConfig<TRequest, TResult, TPreferences>
): UseAnalysisHydrationReturn<TPreferences> {
  const {
    workspaceId,
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

  const hydrateFromServer = useCallback(async () => {
    if (!workspaceId || inflightRef.current) {
      return inflightRef.current ?? Promise.resolve();
    }

    const inflight = (async () => {
      setHydrationState((prev) => ({ ...prev, status: 'loading', error: undefined }));
      try {
        if (fetchRequest && applyRequest) {
          const requestPayload = await fetchRequest();
          await applyRequest(requestPayload ?? null);
        }
        if (fetchResult && applyResult) {
          const resultPayload = await fetchResult();
          await applyResult(resultPayload ?? null);
        }
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
  }, [workspaceId, fetchRequest, fetchResult, applyRequest, applyResult, onHydrationError]);

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

  const persistPreferencesSafe = useCallback(
    async (partial: TPreferences) => {
      if (!persistPreferences || !workspaceId || !partial) return;
      const normalized = normalizePreferencePayload(partial);
      await persistPreferences(normalized);
    },
    [persistPreferences, workspaceId]
  );

  return useMemo(
    () => ({
      hydrateFromServer,
      hydrationState,
      persistPreferences: persistPreferencesSafe,
    }),
    [hydrateFromServer, hydrationState, persistPreferencesSafe]
  );
}
