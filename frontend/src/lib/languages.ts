/** Curated language list for UI selectors and tokenizer inventory. */
export interface LanguageModelOption {
  /** Tokenizer model ID — what gets sent to the backend. */
  model: string;
  /** Human label shown in model pickers. */
  label: string;
}

export interface LanguageOption {
  code: string;
  label: string;
  /**
   * Marker for languages quotation-extractor supports (Phase 3.6 /
   * decision 4 = English only). Drives the disabled-with-tooltip
   * indicator in tool menus.
   */
  quotationSupported: boolean;
  /** Predefined tokenizer models known to support this language. */
  models?: ReadonlyArray<LanguageModelOption>;
}

export const SUPPORTED_LANGUAGES: readonly LanguageOption[] = [
  {
    code: 'en',
    label: 'English',
    quotationSupported: true,
    models: [
      { model: 'native:plain_words_en', label: 'Plain words (English)' },
      { model: 'huggingface:bert-base-uncased', label: 'BERT base uncased' },
    ],
  },
  {
    code: 'zh',
    label: 'Chinese',
    quotationSupported: false,
    models: [
      { model: 'lindera:cc-cedict', label: 'CC-CEDICT' },
      { model: 'lindera:jieba', label: 'Jieba' },
    ],
  },
  {
    code: 'ja',
    label: 'Japanese',
    quotationSupported: false,
    models: [
      { model: 'lindera:ja-ipadic', label: 'IPADIC' },
      { model: 'lindera:ja-ipadic-neologd', label: 'IPADIC Neologd' },
      { model: 'lindera:ja-unidic', label: 'UniDic' },
    ],
  },
  {
    code: 'ko',
    label: 'Korean',
    quotationSupported: false,
    models: [{ model: 'lindera:ko-dic', label: 'ko-dic' }],
  },
  {
    code: 'multi',
    label: 'Other / Multilingual',
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
