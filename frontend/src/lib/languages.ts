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
/**
 * Optional dict choice surfaced for languages where multiple morpheme
 * dictionaries are available (Japanese: IPADIC vs UniDic). The Tokenise
 * dialog renders a secondary selector when ``availableDicts`` is set and
 * has more than one entry; the first entry should match
 * ``recommendedModel`` so opening the dialog preselects the default.
 */
export interface LanguageDictOption {
  /** Tokenizer model ID — what gets sent to the backend. */
  model: string;
  /** Human label (with size hint) shown in the dict dropdown. */
  label: string;
}

export interface LanguageOption {
  code: string;
  label: string;
  /**
   * Tokenizer model recommended for this language. Matches the backend's
   * ``recommended_tokenizer_for(language)``; the Tokenise dialog (Phase
   * 4.3) seeds the model field from this so a CJK user doesn't have to
   * know the model ID. JA + KO now point at Lindera model IDs
   * (``lindera-ja-ipadic`` / ``lindera-ko-dic``) — the matching dict is
   * downloaded on first use into ``~/.cache/ldaca/lindera/``.
   */
  recommendedModel: string;
  /**
   * Marker for languages quotation-extractor supports (Phase 3.6 /
   * decision 4 = English only). Drives the disabled-with-tooltip
   * indicator in tool menus.
   */
  quotationSupported: boolean;
  /**
   * Phase 5: per-language dictionary choices. Only Japanese has more
   * than one practical option (IPADIC vs UniDic). When set + length>1,
   * the Tokenise dialog shows a "Dictionary" selector and the chosen
   * dict's model becomes the request payload.
   */
  availableDicts?: ReadonlyArray<LanguageDictOption>;
  /**
   * Phase 5: when the recommended tokenizer triggers a first-use
   * download (Lindera dicts), the Tokenise dialog surfaces this hint
   * next to the model input. Empty for fast-loading defaults (HF
   * tokenizers cached by hf-hub, Jieba bundled in the wheel).
   */
  firstUseHint?: string;
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
    recommendedModel: 'lindera-ja-ipadic',
    quotationSupported: false,
    availableDicts: [
      { model: 'lindera-ja-ipadic', label: 'IPADIC (recommended, ~15 MB)' },
      { model: 'lindera-ja-unidic', label: 'UniDic (more accurate, ~50 MB)' },
    ],
    firstUseHint:
      'First use downloads the morpheme dictionary (~15 MB for IPADIC, ~50 MB for UniDic) into the local cache.',
  },
  {
    code: 'ko',
    label: 'Korean',
    recommendedModel: 'lindera-ko-dic',
    quotationSupported: false,
    firstUseHint:
      'First use downloads the ko-dic morpheme dictionary (~34 MB) into the local cache.',
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
