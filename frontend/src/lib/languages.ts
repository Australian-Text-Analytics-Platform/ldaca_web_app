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

export function normaliseIso6391LanguageCode(code: string | null | undefined): string | null {
  if (typeof code !== 'string') return null;
  const trimmed = code.trim().toLowerCase();
  if (!trimmed) return null;
  const primary = trimmed.split(/[-_]/, 1)[0];
  return primary && /^[a-z]{2}$/.test(primary) ? primary : null;
}

export function findLanguage(code: string | null | undefined): LanguageOption | null {
  const normalised = normaliseIso6391LanguageCode(code);
  if (!normalised) return null;
  return SUPPORTED_LANGUAGES.find((l) => l.code === normalised) ?? null;
}

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

export function orderedTokenizerModelsForLanguage(
  models: readonly LanguageModelOption[],
  code: string | null | undefined,
): readonly LanguageModelOption[] {
  const { recommended, other } = partitionTokenizerModelsForLanguage(models, code);
  return [...recommended, ...other];
}

export function languageLabel(code: string | null | undefined): string {
  const found = findLanguage(code);
  if (found) return found.label;
  if (typeof code === 'string' && code.trim()) return code;
  return 'English';
}
