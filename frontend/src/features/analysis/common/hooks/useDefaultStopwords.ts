import { useQueries } from '@tanstack/react-query';
import { textApi } from '@/lib/backend/text';
import { useAuth } from '@/hooks/useAuth';
import { queryKeys } from '@/lib/queryKeys';

export interface DefaultStopwordsLanguageGroup {
  /** Normalised language code that was actually requested. */
  language: string;
  /** Words returned by the backend for this language, in source order
   *  with surrounding whitespace trimmed. Empty when the backend has
   *  no list and ``strict`` suppressed the English fallback. */
  words: string[];
}

interface UseDefaultStopwordsResult {
  /** Flat, deduplicated merge across all requested languages, keyed by
   *  surface form. The filtering memo only needs membership lookup,
   *  so this is the primary consumer-facing field. */
  stopwords: Set<string>;
  /** Per-language groups in the order requested. Surfaces multi-lang
   *  state to UI that wants to label things like "Filtering EN + ZH"
   *  or render grouped chips. Empty when no languages were resolved. */
  byLanguage: DefaultStopwordsLanguageGroup[];
  /** True once at least one fetch has returned a non-empty list. Drives
   *  "is the toggle worth showing" — when false, callers should hide
   *  the filter UI entirely rather than greying it out. */
  available: boolean;
  isLoading: boolean;
  isError: boolean;
}

/**
 * Cached fetch of the bundled stop-word lists for one or more
 * languages. Mirrors the multi-language behaviour token-frequency uses
 * via ``loadMergedStopwords`` but as a React hook so topic-modelling
 * (and any future analysis) can subscribe reactively.
 *
 * The single-language call site that existed before this refactor —
 * ``useDefaultStopwords('zh', ...)`` — now passes ``['zh']``. Empty /
 * ``null`` entries in the array are skipped during normalisation, so
 * placeholder-during-render states stay safe.
 *
 * Caching: each unique ``(language, strict)`` pair gets its own
 * 1-hour-stale TanStack Query entry keyed via
 * ``queryKeys.defaultStopWords``, so two analyses asking for ZH at
 * the same time hit the backend once.
 */
export const useDefaultStopwords = (
  languages: ReadonlyArray<string | null | undefined>,
  { strict = true }: { strict?: boolean } = {},
): UseDefaultStopwordsResult => {
  const { getAuthHeaders } = useAuth();

  const uniqueLanguages = normalizeLanguages(languages);

  const queryResults = useQueries({
    queries: uniqueLanguages.map((language) => ({
      queryKey: queryKeys.defaultStopWords(language, strict),
      staleTime: 1000 * 60 * 60,
      queryFn: async () =>
        textApi.defaultStopWords(getAuthHeaders(), { language, strict }),
    })),
  });

  const byLanguage = uniqueLanguages.map((language, index) => {
    const raw = queryResults[index]?.data?.stopwords;
    const words = Array.isArray(raw)
      ? raw.map((word) => String(word).trim()).filter(Boolean)
      : [];
    return { language, words };
  });

  const stopwords = new Set<string>();
  for (const group of byLanguage) {
    for (const word of group.words) stopwords.add(word);
  }

  const isLoading =
    uniqueLanguages.length > 0 && queryResults.some((q) => q.isLoading);
  const isError =
    uniqueLanguages.length > 0 && queryResults.some((q) => q.isError);

  return {
    stopwords,
    byLanguage,
    available: uniqueLanguages.length > 0 && stopwords.size > 0,
    isLoading,
    isError,
  };
};

function normalizeLanguages(
  languages: ReadonlyArray<string | null | undefined>,
): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const candidate of languages) {
    if (typeof candidate !== 'string') continue;
    const code = candidate.trim().toLowerCase();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    ordered.push(code);
  }
  return ordered;
}
