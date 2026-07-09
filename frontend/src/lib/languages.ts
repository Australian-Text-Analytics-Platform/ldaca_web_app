import type { TokenizerModelInfo } from '@/api';

/** Curated language list for UI selectors. */
export type LanguageModelOption = TokenizerModelInfo;

/**
 * Normalizes stored/user language strings to the two-letter codes used by UI controls.
 * Why: importers need one shared normalization boundary to keep behavior consistent.
 */
export function normaliseIso6391LanguageCode(code: string | null | undefined): string | null {
  if (typeof code !== 'string') return null;
  const trimmed = code.trim().toLowerCase();
  if (!trimmed) return null;
  const primary = trimmed.split(/[-_]/, 1)[0];
  return primary && /^[a-z]{2}$/.test(primary) ? primary : null;
}

/** Splits tokenizer models into language-matching recommendations and secondary choices. */
/**
 * Used by: src/features/views/common/components/TokenizerModelSelector.tsx, src/lib/__tests__/languages.test.ts.
 * Flow: normalize the language code, return all models as secondary when unknown, otherwise partition by model language support.
 */
export function partitionTokenizerModelsForLanguage(
  models: readonly LanguageModelOption[],
  code: string | null | undefined,
): { recommended: LanguageModelOption[]; other: LanguageModelOption[] } {
  const normalised = normaliseIso6391LanguageCode(code);
  if (!normalised) {
    return { recommended: [], other: [...models] };
  }
  const recommended = models.filter((option) => option.languages.includes(normalised));
  const other = models.filter((option) => !option.languages.includes(normalised));
  return { recommended, other };
}

/** Returns tokenizer models in the order selectors expect: recommended first, then the rest. */
/** Used by: src/lib/__tests__/languages.test.ts. */
export function orderedTokenizerModelsForLanguage(
  models: readonly LanguageModelOption[],
  code: string | null | undefined,
): readonly LanguageModelOption[] {
  const { recommended, other } = partitionTokenizerModelsForLanguage(models, code);
  return [...recommended, ...other];
}
