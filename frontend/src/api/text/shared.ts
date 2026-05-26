/**
 * Pagination shape used by analysis features that paginate by *source row*
 * (e.g. concordance / quotation), where each source row may produce
 * multiple result rows.
 */
export interface SourceRowPagination {
  page: number;
  page_size: number;
  total_source_rows: number;
  total_source_pages: number;
  result_count: number;
  has_next: boolean;
  has_prev: boolean;
}

/**
 * ISO-style language code (e.g. ``"en"``, ``"zh"``, ``"ja"``). Phase 4
 * threading: every analysis request that has per-language behaviour
 * carries an optional ``language`` so the frontend can override the
 * backend's per-request fallback chain
 * (request -> tokenization metadata -> ``"en"``). Use :func:`buildLanguageHint`
 * to combine an explicit override with the per-user
 * ``defaultLanguage`` preference.
 */
export type LanguageCode = string;

/**
 * Phase 4.4 request augment — added as ``language?: LanguageCode`` to
 * every per-feature request type so route handlers can apply the Phase 3
 * gates (quotation), prompt hints (AI annotation), embedder routing
 * (topic modeling), label stop-words (topic modeling), or concordance
 * tokens-mode auto-pick.
 */
export interface LanguageHint {
  language?: LanguageCode;
}

/**
 * Pick a language code for an analysis request. Explicit override wins;
 * the per-user default fills in when the caller passes ``undefined``.
 * ``null`` / empty strings are normalised out so the backend sees
 * ``undefined`` (which it interprets as "fall back to your own resolver").
 */
export function buildLanguageHint(
  explicit: LanguageCode | undefined | null,
  defaultLanguage: LanguageCode | undefined | null,
): LanguageCode | undefined {
  const explicitTrimmed =
    typeof explicit === 'string' && explicit.trim() ? explicit.trim() : null;
  if (explicitTrimmed) return explicitTrimmed;
  const fallback =
    typeof defaultLanguage === 'string' && defaultLanguage.trim()
      ? defaultLanguage.trim()
      : null;
  return fallback ?? undefined;
}
