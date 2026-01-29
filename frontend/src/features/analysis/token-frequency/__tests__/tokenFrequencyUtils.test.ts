import { describe, it, expect } from 'vitest';
import type { TokenFrequencyResponse } from '@/api/text';
import {
  buildSelectionNameKey,
  buildSelectionNameById,
  deriveBackendTokenLimit,
  deriveBackendStopWords,
  deriveBackendStopWordsKey,
} from '../tokenFrequencyUtils';

describe('tokenFrequencyUtils', () => {
  it('deriveBackendTokenLimit prefers explicit token_limit over metadata/limit', () => {
    const result: TokenFrequencyResponse = {
      state: 'successful',
      data: null,
      token_limit: 42,
      analysis_params: { token_limit: 11 },
      metadata: { token_limit: 7, limit: 99 },
    };

    expect(deriveBackendTokenLimit(result)).toBe(42);
  });

  it('deriveBackendStopWords returns stop words from metadata/analysis params when present', () => {
    const result: TokenFrequencyResponse = {
      state: 'successful',
      data: null,
      metadata: { stop_words: ['the', 'and'] },
      analysis_params: { stop_words: ['ignored'] },
    };

    expect(deriveBackendStopWords(result)).toEqual(['the', 'and']);
  });

  it('deriveBackendStopWordsKey normalizes and joins stop words deterministically', () => {
    const result: TokenFrequencyResponse = {
      state: 'successful',
      data: null,
      metadata: { stop_words: [' The ', 'AND', '', '  '] },
    };

    expect(deriveBackendStopWordsKey(result)).toBe('the|and');
  });

  it('buildSelectionNameById merges selected + panel nodes with panel precedence', () => {
    const selected = [{ id: 'a', name: 'Alpha' }];
    const panel = [{ id: 'a', name: 'Panel A' }, { id: 'b', name: 'Beta' }];

    expect(buildSelectionNameById(selected, panel)).toEqual({
      a: 'Panel A',
      b: 'Beta',
    });
  });

  it('buildSelectionNameKey produces a stable key from merged names', () => {
    const selected = [{ id: 'b', name: 'Beta' }, { id: 'a', name: 'Alpha' }];
    const panel = [{ id: 'a', name: 'Panel A' }];

    expect(buildSelectionNameKey(selected, panel)).toBe('a:Panel A|b:Beta');
  });
});