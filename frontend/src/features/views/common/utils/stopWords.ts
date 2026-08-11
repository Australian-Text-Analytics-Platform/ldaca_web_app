// Accept commas and newlines so pasted grouped stop-word lists survive a round
// trip through any analysis editor.
const STOPWORD_SEPARATOR_RE = /[,\n\r]+/;

/** Normalizes editable stop-word text with stable, lower-case deduplication. */
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

/** Formats normalized stop words for comma-separated editors. */
export function formatStopWords(words: string[]): string {
  return words.join(', ');
}

/** Appends default stop words to editable text without adding duplicates. */
export function mergeStopWordsText(existingText: string, appendedWords: string[]): string[] {
  return parseStopWordsText(formatStopWords([existingText, formatStopWords(appendedWords)]));
}
