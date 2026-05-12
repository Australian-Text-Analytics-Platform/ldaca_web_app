/**
 * Curated language list for UI selectors. Codes match
 * ``polars_text.models.RECOMMENDED_TOKENIZERS`` and the backend's
 * ``effective_language`` resolution rules so a user's selection round-trips
 * end-to-end.
 *
 * The ``label`` is what's shown to humans (English label, since the app
 * shell is English); ``code`` is what's stored / sent to the API. Add
 * languages here at a single point so AddFilePanel (Phase 4.2),
 * Tokenise dialog (Phase 4.3), and any future selector stay consistent.
 */
export interface LanguageOption {
  code: string;
  label: string;
  /**
   * Tokenizer model recommended for this language. Matches the backend's
   * ``recommended_tokenizer_for(language)``; the Tokenise dialog (Phase
   * 4.3) seeds the model field from this so a CJK user doesn't have to
   * know the model ID.
   */
  recommendedModel: string;
  /**
   * Marker for languages quotation-extractor supports (Phase 3.6 /
   * decision 4 = English only). Drives the disabled-with-tooltip
   * indicator in tool menus.
   */
  quotationSupported: boolean;
}

export const SUPPORTED_LANGUAGES: readonly LanguageOption[] = [
  {
    code: 'en',
    label: 'English',
    recommendedModel: 'bert-base-uncased',
    quotationSupported: true,
  },
  {
    code: 'zh',
    label: 'Chinese',
    recommendedModel: 'jieba',
    quotationSupported: false,
  },
  {
    code: 'ja',
    label: 'Japanese',
    recommendedModel: 'cl-tohoku/bert-base-japanese-v3',
    quotationSupported: false,
  },
  {
    code: 'multi',
    label: 'Other / Multilingual',
    recommendedModel: 'xlm-roberta-base',
    quotationSupported: false,
  },
] as const;

export function findLanguage(code: string | null | undefined): LanguageOption | null {
  if (typeof code !== 'string') return null;
  const normalised = code.trim().toLowerCase();
  return SUPPORTED_LANGUAGES.find((l) => l.code === normalised) ?? null;
}

export function languageLabel(code: string | null | undefined): string {
  const found = findLanguage(code);
  if (found) return found.label;
  if (typeof code === 'string' && code.trim()) return code;
  return 'English';
}
