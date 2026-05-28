declare module 'stopword' {
  /**
   * Third-party API used by local stopword previews and compatibility tests.
   * Why: importers need one shared normalization boundary to keep behavior consistent.
   */
  export function removeStopwords(words: readonly string[], stopwords?: readonly string[]): string[];

  export const eng: string[];
  export const zho: string[];
  export const jpn: string[];
  export const kor: string[];
}