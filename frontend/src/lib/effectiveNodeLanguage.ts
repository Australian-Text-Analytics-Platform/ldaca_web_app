/**
 * Frontend language resolver for per-tool UI defaults.
 *
 * Resolution order:
 *   1. ``explicit`` — caller-supplied string (e.g. selector value).
 *   2. ``defaultLanguage`` — per-user preference from the store.
 *   3. ``"en"`` — global fallback so existing English flows stay quiet.
 */
export const DEFAULT_LANGUAGE = 'en';

/** Normalizes optional language inputs from node metadata, controls, and preferences. */
/** Called by: DEFAULT_LANGUAGE and effectiveNodeLanguage in this library module because the library needs this local step to isolate browser, data, or runtime edge cases for importers. */
function normalise(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed || null;
}

/** Resolves the language a tool should use for node-sensitive defaults. */
/** Used by: src/features/views/concordance/ConcordanceFeature.tsx, src/features/views/quotation/QuotationFeature.tsx, src/features/views/topic-modeling/TopicModelingFeature.tsx and 1 other importers because the library needs this local step to isolate browser, data, or runtime edge cases for importers. */
export function effectiveNodeLanguage(args: {
  explicit?: string | null;
  defaultLanguage?: string | null;
}): string {
  const explicit = normalise(args.explicit);
  if (explicit) return explicit;

  const fallback = normalise(args.defaultLanguage);
  if (fallback) return fallback;
  return DEFAULT_LANGUAGE;
}

/** Lets English-only tools keep simple capability checks at their call sites. */
/** Used by: src/features/views/quotation/QuotationFeature.tsx, src/lib/__tests__/effectiveNodeLanguage.test.ts because the tests need reusable fixtures or mocks before exercising the behavior under assertion. */
export function isEnglish(language: string): boolean {
  return normalise(language) === DEFAULT_LANGUAGE;
}
