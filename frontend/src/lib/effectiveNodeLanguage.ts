/**
 * Frontend language resolver for per-tool UI defaults.
 *
 * Resolution order:
 *   1. ``explicit`` — caller-supplied string (e.g. selector value).
 *   2. ``defaultLanguage`` — per-user preference from the store.
 *   3. ``"en"`` — global fallback so existing English flows stay quiet.
 */
export const DEFAULT_LANGUAGE = 'en';

function normalise(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed || null;
}

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

export function isEnglish(language: string): boolean {
  return normalise(language) === DEFAULT_LANGUAGE;
}
