/**
 * Load client-side default stop-word lists for one or more saved language codes
 * and combine them into a single user-facing payload.
 *
 * Used by: because the library needs this local step to isolate browser, data, or runtime edge cases for importers.
 * - Token-frequency's "Apply Stop Words" action, which spans the saved
 *   tokenizer languages for selected corpora so multilingual comparisons fill
 *   with all relevant stoplists merged into one textarea.
 * - Future topic-modelling stopword UI — same shape applies once we surface a
 *   "currently-applied stopwords" view there.
 *
 * Why:
 * - Centralises the "resolve N stoplists, dedupe by surface form, keep
 *   per-language groups for display" logic so individual analyses don't
 *   re-implement the merge each time, and so behaviour stays consistent across
 *   tools (same dedup rules, same ordering).
 *
 * Behaviour:
 * - Input languages are normalised (trim + lowercase + remove region suffix)
 *   and deduplicated in input order after ISO 639-1 to ISO 639-3 conversion.
 * - Unsupported languages are ignored so a missing third-party stopword list
 *   does not block lists that are available.
 * - ``merged`` deduplicates across languages on exact surface form
 *   (post-trim, preserving original case so e.g. ``Inc`` and ``inc``
 *   stay distinct — matching how the existing textarea treats words).
 */
import { iso6393 } from 'iso-639-3';
import * as stopwordLists from 'stopword';

export interface MergedStopwordsLanguageGroup {
  /** Normalised ISO 639-1 language code resolved from node metadata. */
  language: string;
  /** The words returned for this language, trimmed but otherwise verbatim. */
  words: string[];
}

export interface MergedStopwordsResult {
  /** Per-language entries in the order requested. One group per
   *  *unique* normalised language code; duplicates are coalesced. */
  byLanguage: MergedStopwordsLanguageGroup[];
  /** Flat, in-order deduplicated merge across all groups. Convenient
   *  when the caller just needs ``Set<string>`` membership. */
  merged: string[];
}

type StopwordExports = Record<string, unknown>;

const stopwordExports = stopwordLists as StopwordExports;

/** Converts UI/user language strings to the primary code used for stopword lookup. */
/** Called by: resolveMergedStopwords and loadMergedStopwords in this library module because the library needs this local step to isolate browser, data, or runtime edge cases for importers. */
const normaliseLanguageCode = (raw: string): string => raw.trim().toLowerCase().split(/[-_]/)[0] ?? '';

const iso6393ByIso6391 = new Map(
  iso6393
    .filter((language) => language.iso6391 && language.iso6393)
    .map((language) => [language.iso6391, language.iso6393] as const),
);

/** Maps ISO 639-1/639-3 inputs to the third-party stopword package's export keys. */
/** Called by: resolveMergedStopwords and loadMergedStopwords in this library module because the library needs this local step to isolate browser, data, or runtime edge cases for importers. */
const resolveStopwordLanguageCode = (language: string): string | null => {
  const normalised = normaliseLanguageCode(language);
  if (!normalised) return null;
  if (normalised.length === 3) return normalised;
  return iso6393ByIso6391.get(normalised) ?? null;
};

/** Reads one stopword export while treating unsupported package keys as an empty list. */
/** Called by: resolveMergedStopwords and loadMergedStopwords in this library module because the library needs this local step to isolate browser, data, or runtime edge cases for importers. */
const getStopwordList = (iso6393Code: string): string[] => {
  const list = stopwordExports[iso6393Code];
  if (!Array.isArray(list)) return [];
  return list.map((word) => String(word).trim()).filter(Boolean);
};

/** Resolves and deduplicates stopwords synchronously for callers/tests that already have languages. */
/**
 * Used by: src/features/analysis/common/hooks/useDefaultStopwords.ts because the library needs this local step to isolate browser, data, or runtime edge cases for importers.
 * Flow: validate inputs, normalize values, branch on runtime conditions, then return the shared result.
 */
export function resolveMergedStopwords(
  languages: ReadonlyArray<string | null | undefined>,
): MergedStopwordsResult {
  const seen = new Set<string>();
  const ordered: { language: string; stopwordLanguage: string }[] = [];
  for (const candidate of languages) {
    if (typeof candidate !== 'string') continue;
    const language = normaliseLanguageCode(candidate);
    const stopwordLanguage = resolveStopwordLanguageCode(language);
    if (!language || !stopwordLanguage || seen.has(stopwordLanguage)) continue;
    seen.add(stopwordLanguage);
    ordered.push({ language, stopwordLanguage });
  }

  if (ordered.length === 0) {
    return { byLanguage: [], merged: [] };
  }

  const byLanguage: MergedStopwordsLanguageGroup[] = ordered.map(
    ({ language, stopwordLanguage }) => ({
      language,
      words: getStopwordList(stopwordLanguage),
    }),
  );

  const mergedSeen = new Set<string>();
  const merged: string[] = [];
  for (const group of byLanguage) {
    for (const word of group.words) {
      if (mergedSeen.has(word)) continue;
      mergedSeen.add(word);
      merged.push(word);
    }
  }

  return { byLanguage, merged };
}

/** Async facade for UI actions that may later load stopword sources dynamically. */
/** Used by: src/features/analysis/token-frequency/hooks/useTokenFrequencyPreferences.ts, src/lib/__tests__/loadMergedStopwords.test.ts because the tests need reusable fixtures or mocks before exercising the behavior under assertion. */
export async function loadMergedStopwords(args: {
  languages: ReadonlyArray<string | null | undefined>;
}): Promise<MergedStopwordsResult> {
  return resolveMergedStopwords(args.languages);
}
