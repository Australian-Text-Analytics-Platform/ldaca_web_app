import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { textApi } from '@/api/text';
import { useAuth } from '@/hooks/useAuth';
import { queryKeys } from '@/lib/queryKeys';

interface UseDefaultStopwordsResult {
  /** Set keyed by exact stop-word string. Empty until the query resolves
   *  or when the backend has no list for the language. */
  stopwords: Set<string>;
  /** True once the fetch has resolved successfully and the backend
   *  returned at least one entry. Drives "is the toggle worth showing". */
  available: boolean;
  isLoading: boolean;
  isError: boolean;
}

/**
 * Cached fetch of the bundled stop-word list for a language. Shared
 * across analyses so token-frequency and topic-modelling don't each
 * pay a request when they happen to need the same list.
 *
 * ``strict`` controls the unknown-language fallback at the backend:
 *  - ``true`` (topic-modelling filter): unknown languages return ``[]``,
 *    ``available`` becomes false, callers can hide the UI cleanly.
 *  - ``false`` (token-frequency "fill defaults"): unknown languages
 *    silently get the English list — legacy behaviour.
 */
export const useDefaultStopwords = (
  language: string | null | undefined,
  { strict = true }: { strict?: boolean } = {},
): UseDefaultStopwordsResult => {
  const { getAuthHeaders } = useAuth();
  const code = (language ?? '').trim().toLowerCase();
  const enabled = code.length > 0;

  const query = useQuery({
    queryKey: queryKeys.defaultStopWords(code, strict),
    enabled,
    staleTime: 1000 * 60 * 60, // 1h — these lists don't change at runtime
    queryFn: async () =>
      textApi.defaultStopWords(getAuthHeaders(), { language: code, strict }),
  });

  const stopwords = useMemo(() => {
    const list = query.data?.stopwords;
    if (!Array.isArray(list)) return new Set<string>();
    return new Set(list.map((w) => String(w).trim()).filter(Boolean));
  }, [query.data?.stopwords]);

  return {
    stopwords,
    available: enabled && stopwords.size > 0,
    isLoading: enabled && query.isLoading,
    isError: enabled && query.isError,
  };
};
