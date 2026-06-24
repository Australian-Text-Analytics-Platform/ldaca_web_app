import { describe, expect, it } from 'vitest';

import {
  formatStopWords,
  mergeStopWordsText,
  parseStopWordsText,
} from '../tokenFrequencyStopWords';

describe('tokenFrequencyStopWords', () => {
  it('parses comma and newline separated stop words with stable lower-case dedupe', () => {
    expect(parseStopWordsText('About, the\nABOUT\r\n  and ,, the')).toEqual([
      'about',
      'the',
      'and',
    ]);
  });

  it('formats parsed stop words for the editor', () => {
    expect(formatStopWords(['about', 'the', 'and'])).toBe('about, the, and');
  });

  it('merges default stop words without duplicating existing editor entries', () => {
    expect(mergeStopWordsText('about, the', ['The', 'and'])).toEqual(['about', 'the', 'and']);
  });
});
