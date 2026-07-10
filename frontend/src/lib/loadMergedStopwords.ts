/**
 * Load client-side default stop-word lists for one or more saved language codes
 * and combine them into a single user-facing payload.
 *
 * Used by: Token Frequency's preference hook for the "Apply Stop Words"
 * action, which spans the saved tokenizer languages for selected corpora so
 * multilingual comparisons fill with all relevant stoplists in one textarea.
 *
 * Why:
 * - Centralises the "resolve N stoplists, dedupe by surface form, keep
 *   per-language groups for display" logic so individual analyses don't
 *   re-implement the merge for each selection (same dedup rules and ordering).
 *
 * Behaviour:
 * - Input languages are normalised (trim + lowercase + remove region suffix)
 *   and deduplicated in input order after ISO 639-1 to ISO 639-3 conversion.
 * - Unsupported languages are ignored so a missing third-party stopword list
 *   does not block lists that are available.
 * - ``merged`` deduplicates across languages on exact surface form
 *   (post-trim, preserving original case so e.g. ``Inc`` and ``inc``
 *   stay distinct — matching how the existing textarea treats words).
 */
interface MergedStopwordsLanguageGroup {
  /** Normalised ISO 639-1 language code resolved from node metadata. */
  language: string;
  /** The words returned for this language, trimmed but otherwise verbatim. */
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

type StopwordExports = Record<string, unknown>;

interface StopwordLanguageMetadata {
  /** Export key used by the third-party stopword package. */
  stopwordCode: string;
  /** Two-letter language code accepted by this app's UI and detector flows. */
  iso6391: string;
  /** Label shown in the default stop-word picker. */
  name: string;
}

// Generated from the stopword package's array exports plus ISO language names.
// Keeping the small supported-language table here avoids shipping the full
// iso-639-3 dataset in the token-frequency route chunk.
const STOPWORD_LANGUAGE_METADATA = [
  { stopwordCode: 'afr', iso6391: 'af', name: 'Afrikaans' },
  { stopwordCode: 'ara', iso6391: 'ar', name: 'Arabic' },
  { stopwordCode: 'hye', iso6391: 'hy', name: 'Armenian' },
  { stopwordCode: 'eus', iso6391: 'eu', name: 'Basque' },
  { stopwordCode: 'ben', iso6391: 'bn', name: 'Bengali' },
  { stopwordCode: 'bre', iso6391: 'br', name: 'Breton' },
  { stopwordCode: 'bul', iso6391: 'bg', name: 'Bulgarian' },
  { stopwordCode: 'mya', iso6391: 'my', name: 'Burmese' },
  { stopwordCode: 'cat', iso6391: 'ca', name: 'Catalan' },
  { stopwordCode: 'zho', iso6391: 'zh', name: 'Chinese' },
  { stopwordCode: 'hrv', iso6391: 'hr', name: 'Croatian' },
  { stopwordCode: 'ces', iso6391: 'cs', name: 'Czech' },
  { stopwordCode: 'dan', iso6391: 'da', name: 'Danish' },
  { stopwordCode: 'nld', iso6391: 'nl', name: 'Dutch' },
  { stopwordCode: 'eng', iso6391: 'en', name: 'English' },
  { stopwordCode: 'epo', iso6391: 'eo', name: 'Esperanto' },
  { stopwordCode: 'est', iso6391: 'et', name: 'Estonian' },
  { stopwordCode: 'fin', iso6391: 'fi', name: 'Finnish' },
  { stopwordCode: 'fra', iso6391: 'fr', name: 'French' },
  { stopwordCode: 'glg', iso6391: 'gl', name: 'Galician' },
  { stopwordCode: 'deu', iso6391: 'de', name: 'German' },
  { stopwordCode: 'guj', iso6391: 'gu', name: 'Gujarati' },
  { stopwordCode: 'hau', iso6391: 'ha', name: 'Hausa' },
  { stopwordCode: 'heb', iso6391: 'he', name: 'Hebrew' },
  { stopwordCode: 'hin', iso6391: 'hi', name: 'Hindi' },
  { stopwordCode: 'hun', iso6391: 'hu', name: 'Hungarian' },
  { stopwordCode: 'ind', iso6391: 'id', name: 'Indonesian' },
  { stopwordCode: 'gle', iso6391: 'ga', name: 'Irish' },
  { stopwordCode: 'ita', iso6391: 'it', name: 'Italian' },
  { stopwordCode: 'jpn', iso6391: 'ja', name: 'Japanese' },
  { stopwordCode: 'kor', iso6391: 'ko', name: 'Korean' },
  { stopwordCode: 'kur', iso6391: 'ku', name: 'Kurdish' },
  { stopwordCode: 'lat', iso6391: 'la', name: 'Latin' },
  { stopwordCode: 'lav', iso6391: 'lv', name: 'Latvian' },
  { stopwordCode: 'lit', iso6391: 'lt', name: 'Lithuanian' },
  { stopwordCode: 'msa', iso6391: 'ms', name: 'Malay (macrolanguage)' },
  { stopwordCode: 'mar', iso6391: 'mr', name: 'Marathi' },
  { stopwordCode: 'ell', iso6391: 'el', name: 'Modern Greek (1453-)' },
  { stopwordCode: 'nob', iso6391: 'nb', name: 'Norwegian Bokmål' },
  { stopwordCode: 'fas', iso6391: 'fa', name: 'Persian' },
  { stopwordCode: 'pol', iso6391: 'pl', name: 'Polish' },
  { stopwordCode: 'por', iso6391: 'pt', name: 'Portuguese' },
  { stopwordCode: 'ron', iso6391: 'ro', name: 'Romanian' },
  { stopwordCode: 'rus', iso6391: 'ru', name: 'Russian' },
  { stopwordCode: 'slk', iso6391: 'sk', name: 'Slovak' },
  { stopwordCode: 'slv', iso6391: 'sl', name: 'Slovenian' },
  { stopwordCode: 'som', iso6391: 'so', name: 'Somali' },
  { stopwordCode: 'sot', iso6391: 'st', name: 'Southern Sotho' },
  { stopwordCode: 'spa', iso6391: 'es', name: 'Spanish' },
  { stopwordCode: 'swa', iso6391: 'sw', name: 'Swahili (macrolanguage)' },
  { stopwordCode: 'swe', iso6391: 'sv', name: 'Swedish' },
  { stopwordCode: 'tgl', iso6391: 'tl', name: 'Tagalog' },
  { stopwordCode: 'tha', iso6391: 'th', name: 'Thai' },
  { stopwordCode: 'tur', iso6391: 'tr', name: 'Turkish' },
  { stopwordCode: 'ukr', iso6391: 'uk', name: 'Ukrainian' },
  { stopwordCode: 'urd', iso6391: 'ur', name: 'Urdu' },
  { stopwordCode: 'vie', iso6391: 'vi', name: 'Vietnamese' },
  { stopwordCode: 'yor', iso6391: 'yo', name: 'Yoruba' },
  { stopwordCode: 'zul', iso6391: 'zu', name: 'Zulu' },
] as const satisfies readonly StopwordLanguageMetadata[];

/** Converts UI/user language strings to the primary code used for stopword lookup. */
/** Called by: stopword-code resolution and merged-list input normalization. */
const normaliseLanguageCode = (raw: string): string =>
  raw.trim().toLowerCase().split(/[-_]/)[0] ?? '';

const stopwordCodeByIso6391 = new Map<string, string>(
  STOPWORD_LANGUAGE_METADATA.map(({ iso6391, stopwordCode }) => [iso6391, stopwordCode]),
);
const supportedStopwordCodes = new Set<string>(
  STOPWORD_LANGUAGE_METADATA.map(({ stopwordCode }) => stopwordCode),
);

let stopwordModulePromise: Promise<StopwordExports> | null = null;

/**
 * Loads the user-triggered stopword implementation once. A failed chunk load
 * clears the same promise so a later retry can recover after connectivity or
 * desktop-resource availability changes; there is no parallel list cache.
 */
const loadStopwordModule = (): Promise<StopwordExports> => {
  stopwordModulePromise ??= import('stopword')
    .then((module) => module as StopwordExports)
    .catch((error: unknown) => {
      stopwordModulePromise = null;
      throw error;
    });
  return stopwordModulePromise;
};

/** Maps ISO 639-1/639-3 inputs to the third-party stopword package's export keys. */
/** Called by: `resolveMergedStopwords` for each requested language. */
const resolveStopwordLanguageCode = (language: string): string | null => {
  const normalised = normaliseLanguageCode(language);
  if (!normalised) return null;
  if (normalised.length === 3 && supportedStopwordCodes.has(normalised)) return normalised;
  return stopwordCodeByIso6391.get(normalised) ?? null;
};

/** Reads one stopword export while treating unsupported package keys as an empty list. */
/** Called by: merged-list construction and supported-language filtering. */
const getStopwordList = (stopwordExports: StopwordExports, stopwordCode: string): string[] => {
  const list = stopwordExports[stopwordCode];
  if (!Array.isArray(list)) return [];
  return list.map((word) => String(word).trim()).filter(Boolean);
};

/** Resolves and deduplicates stopwords synchronously for callers/tests that already have languages. */
/**
 * Called by: the exported async facade below.
 */
function resolveRequestedLanguages(languages: readonly (string | null | undefined)[]) {
  const seen = new Set<string>();
  const ordered: { language: string; stopwordLanguage: string }[] = [];
  for (const candidate of languages) {
    if (typeof candidate !== 'string') continue;
    const language = normaliseLanguageCode(candidate);
    const stopwordLanguage = resolveStopwordLanguageCode(language);
    if (!language || !stopwordLanguage || seen.has(stopwordLanguage)) continue;
    seen.add(stopwordLanguage);
    ordered.push({ language, stopwordLanguage });
  }
  return ordered;
}

function resolveMergedStopwords(
  ordered: { language: string; stopwordLanguage: string }[],
  stopwordExports: StopwordExports,
): MergedStopwordsResult {
  const byLanguage: MergedStopwordsLanguageGroup[] = ordered.map(
    ({ language, stopwordLanguage }) => ({
      language,
      words: getStopwordList(stopwordExports, stopwordLanguage),
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

/** Loads and merges stopwords only after a supported user choice requires the chunk. */
/** Used by: Token Frequency preferences, `FillDefaultStopWordsDialog`, and stopword tests. */
export async function loadMergedStopwords(args: {
  languages: readonly (string | null | undefined)[];
}): Promise<MergedStopwordsResult> {
  const ordered = resolveRequestedLanguages(args.languages);
  if (ordered.length === 0) return { byLanguage: [], merged: [] };
  return resolveMergedStopwords(ordered, await loadStopwordModule());
}

/** A stopword language offered in the "Add Default" picker. */
export interface SupportedStopwordLanguage {
  /** ISO 639-1 code passed back into loadMergedStopwords. */
  iso6391: string;
  /** Human-readable language name for the dropdown label. */
  name: string;
}

/**
 * Lists every language the bundled stopword package can supply, as
 * {iso6391, name} sorted by name. Used by: FillDefaultStopWordsDialog to
 * populate its language dropdown so users pick a stoplist case-by-case instead
 * of relying on a stored per-column language.
 * Flow: return the curated display metadata without requesting the stopword
 * implementation chunk; package/export validation happens when the user loads
 * the selected list.
 */
export function listSupportedStopwordLanguages(): SupportedStopwordLanguage[] {
  return STOPWORD_LANGUAGE_METADATA.map(({ iso6391, name }) => ({ iso6391, name })).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}
