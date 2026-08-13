import { describe, expect, it } from 'vitest';

import {
  concordanceParameterReducer,
  createConcordanceParameterState,
} from '../concordanceParameterState';

describe('concordanceParameterReducer', () => {
  it('starts with the concordance form defaults', () => {
    expect(createConcordanceParameterState()).toEqual({
      searchWord: '',
      numLeftTokens: 10,
      numRightTokens: 10,
      regex: false,
      wholeWord: true,
      caseSensitive: false,
      ignorePunctuation: true,
    });
  });

  it('forces whole-word off when regex mode is enabled', () => {
    const wholeWord = concordanceParameterReducer(createConcordanceParameterState(), {
      type: 'setWholeWord',
      value: true,
    });
    const regex = concordanceParameterReducer(wholeWord, {
      type: 'setRegex',
      value: true,
    });

    expect(regex.regex).toBe(true);
    expect(regex.wholeWord).toBe(false);
  });

  it('hydrates all form fields from normalized server params', () => {
    const state = concordanceParameterReducer(createConcordanceParameterState(), {
      type: 'hydrateParams',
      params: {
        search_word: 'keyword',
        num_left_tokens: 7,
        num_right_tokens: 8,
        regex: true,
        whole_word: true,
        case_sensitive: true,
        ignore_punctuation: false,
      },
    });

    expect(state).toEqual({
      searchWord: 'keyword',
      numLeftTokens: 7,
      numRightTokens: 8,
      regex: true,
      wholeWord: false,
      caseSensitive: true,
      ignorePunctuation: false,
    });
  });
});
