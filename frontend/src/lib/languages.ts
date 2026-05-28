import type { TokenizerModelInfo } from '@/api/generated/types.gen';

/** Curated language list for UI selectors. */
export type LanguageModelOption = TokenizerModelInfo;

export interface LanguageOption {
  code: string;
  label: string;
  /**
   * Marker for languages the quotation extractor supports. Drives the
   * disabled-with-tooltip indicator in tool menus.
   */
  quotationSupported: boolean;
}

export const SUPPORTED_LANGUAGES: readonly LanguageOption[] = [
  {
    code: 'en',
    label: 'English',
    quotationSupported: true,
  },
  {
    code: 'zh',
    label: 'Chinese',
    quotationSupported: false,
  },
  {
    code: 'ja',
    label: 'Japanese',
    quotationSupported: false,
  },
  {
    code: 'ko',
    label: 'Korean',
    quotationSupported: false,
  },
] as const;

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

/** Finds the curated language option, if the code is one the frontend knows how to display. */
/** Used by: src/lib/__tests__/languages.test.ts because the tests need reusable fixtures or mocks before exercising the behavior under assertion. */
export function findLanguage(code: string | null | undefined): LanguageOption | null {
  const normalised = normaliseIso6391LanguageCode(code);
  if (!normalised) return null;
  return SUPPORTED_LANGUAGES.find((l) => l.code === normalised) ?? null;
}

/** Splits tokenizer models into language-matching recommendations and secondary choices. */
/**
 * Used by: src/features/views/common/components/TokenizerModelSelector.tsx, src/lib/__tests__/languages.test.ts because the tests need reusable fixtures or mocks before exercising the behavior under assertion.
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
/** Used by: src/lib/__tests__/languages.test.ts because the tests need reusable fixtures or mocks before exercising the behavior under assertion. */
export function orderedTokenizerModelsForLanguage(
  models: readonly LanguageModelOption[],
  code: string | null | undefined,
): readonly LanguageModelOption[] {
  const { recommended, other } = partitionTokenizerModelsForLanguage(models, code);
  return [...recommended, ...other];
}

/** Provides display text for saved language codes without forcing every caller to handle fallback. */
/** Used by: src/features/views/topic-modeling/components/results/AppliedStopwordsDialog.tsx, src/lib/__tests__/languages.test.ts because the tests need reusable fixtures or mocks before exercising the behavior under assertion. */
export function languageLabel(code: string | null | undefined): string {
  const found = findLanguage(code);
  if (found) return found.label;
  if (typeof code === 'string' && code.trim()) return code;
  return 'English';
}
