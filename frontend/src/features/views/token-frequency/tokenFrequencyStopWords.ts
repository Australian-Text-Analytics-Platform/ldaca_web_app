// Accept commas and newlines so pasted grouped stop-word lists survive a round
// trip through the editor.
const STOPWORD_SEPARATOR_RE = /[,\n\r]+/;

/**
 * Parses editable stop-word text into normalized unique words.
 * Used by: useTokenFrequencyPreferences and tests because applying, sorting,
 * and default-language appends must share one lower-case/dedupe rule.
 */
export function parseStopWordsText(text: string): string[] {
  const seen = new Set<string>();
  const words: string[] = [];

  text
    .split(STOPWORD_SEPARATOR_RE)
    .map((word) => word.trim().toLowerCase())
    .filter(Boolean)
    .forEach((word) => {
      if (seen.has(word)) return;
      seen.add(word);
      words.push(word);
    });

  return words;
}

/**
 * Formats stop-word arrays for the editable textarea.
 * Used by: useTokenFrequencyPreferences after parsing/sorting/default appends
 * so all callers render the same comma-separated representation.
 */
export function formatStopWords(words: string[]): string {
  return words.join(', ');
}

/**
 * Merges existing editor text with newly loaded default stop words.
 * Used by: the default-language stop-word flow so multi-language appends reuse
 * the same parser and dedupe behavior as manual Apply.
 */
export function mergeStopWordsText(existingText: string, appendedWords: string[]): string[] {
  return parseStopWordsText(formatStopWords([existingText, formatStopWords(appendedWords)]));
}
