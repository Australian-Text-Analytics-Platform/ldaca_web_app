import { resolveMergedStopwords } from '@/lib/loadMergedStopwords';

export interface DefaultStopwordsLanguageGroup {
  /** Normalised ISO 639-1 language code that was resolved. */
  language: string;
  /** Words returned for this language, in source order with surrounding whitespace trimmed. */
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
 * Client-side lookup of the default stop-word lists for one or more languages.
 * Mirrors the multi-language behaviour token-frequency uses via
 * ``loadMergedStopwords`` but as a React hook so topic-modelling (and any
 * future analysis) can subscribe reactively.
 *
 * The single-language call site that existed before this refactor —
 * ``useDefaultStopwords('zh', ...)`` — now passes ``['zh']``. Empty /
 * ``null`` entries in the array are skipped during normalisation, so
 * placeholder-during-render states stay safe.
 *
 * The ``strict`` option is retained for call-site compatibility. Unsupported
 * languages are ignored because there is no backend fallback after the default
 * stopword endpoint was removed.
 * Used by: topic-modeling parameter panels and results summaries because callers need shared hook state and handlers without duplicating analysis lifecycle wiring.
 */
export const useDefaultStopwords = (
  languages: ReadonlyArray<string | null | undefined>,
  { strict = true }: { strict?: boolean } = {},
): UseDefaultStopwordsResult => {
  void strict;
  const { byLanguage, merged } = resolveMergedStopwords(languages);
  const stopwords = new Set(merged);

  return {
    stopwords,
    byLanguage,
    available: byLanguage.length > 0 && stopwords.size > 0,
    isLoading: false,
    isError: false,
  };
};
