/**
 * Fetch the bundled default stop-word lists for one or more languages
 * and combine them into a single user-facing payload.
 *
 * Used by:
 * - Token-frequency's "Apply Stop Words" action, which now spans both
 *   selected corpora's languages (so an English/Chinese side-by-side
 *   comparison fills with both stoplists merged into one textarea).
 * - Future topic-modelling stopword UI — same shape applies once we
 *   surface a "currently-applied stopwords" view there.
 *
 * Why:
 * - Centralises the "fetch N stoplists, dedupe by surface form, keep
 *   per-language groups for display" logic so individual analyses don't
 *   re-implement the merge each time, and so behaviour stays consistent
 *   across tools (same dedup rules, same ordering).
 *
 * Behaviour:
 * - Input languages are normalised (trim + lowercase) and deduplicated
 *   in input order. A single repeated language hits the backend once.
 * - Per-language fetches run in parallel via ``Promise.all``. A single
 *   language failure short-circuits the whole call so callers can
 *   surface one error rather than partial data; if you need per-language
 *   resilience, wrap the call in ``Promise.allSettled`` upstream.
 * - ``merged`` deduplicates across languages on exact surface form
 *   (post-trim, preserving original case so e.g. ``Inc`` and ``inc``
 *   stay distinct — matching how the existing textarea treats words).
 */
import { getDefaultStopWords } from '@/api/generated/sdk.gen';
import type { DefaultStopWordsResponse } from '@/api/generated/types.gen';

export interface MergedStopwordsLanguageGroup {
  /** Normalised language code requested (matches what the backend saw). */
  language: string;
  /** The words the backend returned for this language, trimmed but
   *  otherwise verbatim. Empty when the request returned no entries. */
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

const normaliseLanguageCode = (raw: string): string => raw.trim().toLowerCase();

const extractStopwords = (
  payload: DefaultStopWordsResponse | undefined,
): string[] => {
  if (!payload) return [];
  return Array.isArray(payload.stopwords) ? payload.stopwords : [];
};

export async function loadMergedStopwords(args: {
  languages: ReadonlyArray<string | null | undefined>;
  getAuthHeaders: () => Record<string, string>;
}): Promise<MergedStopwordsResult> {
  const { languages, getAuthHeaders } = args;

  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const candidate of languages) {
    if (typeof candidate !== 'string') continue;
    const code = normaliseLanguageCode(candidate);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    ordered.push(code);
  }

  if (ordered.length === 0) {
    return { byLanguage: [], merged: [] };
  }

  const headers = getAuthHeaders();
  const responses = await Promise.all(
    ordered.map(async (language) => {
      const { data } = await getDefaultStopWords({
        headers,
        query: { language, strict: true },
        throwOnError: true,
      });
      return data;
    }),
  );

  const byLanguage: MergedStopwordsLanguageGroup[] = ordered.map(
    (language, index) => ({
      language,
      words: extractStopwords(responses[index])
        .map((word) => String(word).trim())
        .filter(Boolean),
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
