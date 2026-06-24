import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { readConcordanceServerParams, useConcordanceParameters } from '../useConcordanceParameters';

describe('readConcordanceServerParams', () => {
  it('normalizes current and legacy request fields for rerun comparison', () => {
    expect(
      readConcordanceServerParams({
        search_word: 'alpha',
        num_tokens_left: 4,
        num_tokens_right: 6,
        regex: false,
        whole_word: false,
        case_sensitive: true,
      }),
    ).toEqual({
      search_word: 'alpha',
      num_left_tokens: 4,
      num_right_tokens: 6,
      regex: false,
      whole_word: false,
      case_sensitive: true,
    });
  });

  it('forces whole-word off for regex requests', () => {
    expect(
      readConcordanceServerParams({
        search_word: 'equ\\w*',
        num_left_tokens: 10,
        num_right_tokens: 10,
        regex: true,
        whole_word: true,
        case_sensitive: false,
      }),
    ).toMatchObject({
      regex: true,
      whole_word: false,
    });
  });
});

describe('useConcordanceParameters', () => {
  it('starts with the concordance form defaults', () => {
    const { result } = renderHook(() => useConcordanceParameters());

    expect(result.current.currentParams).toEqual({
      search_word: '',
      num_left_tokens: 10,
      num_right_tokens: 10,
      regex: false,
      whole_word: true,
      case_sensitive: false,
    });
  });

  it('disables whole-word when regex is enabled', () => {
    const { result } = renderHook(() => useConcordanceParameters());

    act(() => {
      result.current.setWholeWord(true);
      result.current.setRegex(true);
    });

    expect(result.current.regex).toBe(true);
    expect(result.current.wholeWord).toBe(false);
    expect(result.current.currentParams.whole_word).toBe(false);
  });

  it('hydrates search parameters and input selections from a saved request', () => {
    const { result } = renderHook(() => useConcordanceParameters());
    let selections: ReturnType<typeof result.current.applyHydratedRequest> | undefined;

    act(() => {
      selections = result.current.applyHydratedRequest({
        node_ids: ['node-1', 'node-2', 'node-3'],
        node_columns: { 'node-1': 'text', 'node-2': 'body' },
        search_word: 'keyword',
        num_left_tokens: 7,
        num_right_tokens: 8,
        regex: true,
        whole_word: true,
        case_sensitive: true,
      });
    });

    expect(selections).toEqual([
      { nodeId: 'node-1', column: 'text' },
      { nodeId: 'node-2', column: 'body' },
    ]);
    expect(result.current.searchWord).toBe('keyword');
    expect(result.current.numLeftTokens).toBe(7);
    expect(result.current.numRightTokens).toBe(8);
    expect(result.current.regex).toBe(true);
    expect(result.current.wholeWord).toBe(false);
    expect(result.current.caseSensitive).toBe(true);
  });
});
