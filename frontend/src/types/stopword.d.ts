declare module 'stopword' {
  export function removeStopwords(words: readonly string[], stopwords?: readonly string[]): string[];

  export const eng: string[];
  export const zho: string[];
  export const jpn: string[];
  export const kor: string[];
}