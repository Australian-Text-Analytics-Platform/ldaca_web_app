import { describe, expect, it } from 'vitest';

import {
  createTokenFrequencyPreferenceState,
  tokenFrequencyPreferenceReducer,
} from '../tokenFrequencyPreferenceState';

describe('tokenFrequencyPreferenceReducer', () => {
  it('applies stop words as both editor text and the lookup set', () => {
    const state = tokenFrequencyPreferenceReducer(createTokenFrequencyPreferenceState(), {
      type: 'stopWordsApplied',
      words: ['the', 'and'],
    });

    expect(state.stopWords).toBe('the, and');
    expect([...state.appliedStopSet]).toEqual(['the', 'and']);
  });

  it('keeps public setter-style actions compatible with functional updates', () => {
    const withText = tokenFrequencyPreferenceReducer(createTokenFrequencyPreferenceState(), {
      type: 'stopWordsChanged',
      value: 'alpha',
    });
    const appended = tokenFrequencyPreferenceReducer(withText, {
      type: 'stopWordsChanged',
      value: (current) => `${current}, beta`,
    });

    expect(appended.stopWords).toBe('alpha, beta');
  });

  it('applies token-limit state as override, input text, and cleared error', () => {
    const withError = tokenFrequencyPreferenceReducer(createTokenFrequencyPreferenceState(), {
      type: 'tokenLimitErrorChanged',
      error: 'Invalid limit',
    });
    const applied = tokenFrequencyPreferenceReducer(withError, {
      type: 'tokenLimitStateApplied',
      limit: 75,
    });

    expect(applied.tokenLimitOverride).toBe(75);
    expect(applied.tokenLimitInput).toBe('75');
    expect(applied.tokenLimitError).toBeNull();
  });

  it('clears stale token-limit errors when the input changes', () => {
    const withError = tokenFrequencyPreferenceReducer(createTokenFrequencyPreferenceState(), {
      type: 'tokenLimitErrorChanged',
      error: 'Invalid limit',
    });
    const edited = tokenFrequencyPreferenceReducer(withError, {
      type: 'tokenLimitInputChanged',
      input: '42',
      clearError: true,
    });

    expect(edited.tokenLimitInput).toBe('42');
    expect(edited.tokenLimitError).toBeNull();
  });
});
