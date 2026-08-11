import type { SetStateAction } from 'react';

import { formatStopWords } from '../../common/utils/stopWords';

export interface TokenFrequencyPreferenceState {
  stopWords: string;
  isLoadingStopWords: boolean;
  appliedStopSet: Set<string>;
  tokenLimitOverride: number | null;
  tokenLimitInput: string;
  tokenLimitError: string | null;
  isApplyingTokenLimit: boolean;
}

export type TokenFrequencyPreferenceAction =
  | { type: 'stopWordsChanged'; value: SetStateAction<string> }
  | { type: 'appliedStopSetChanged'; value: SetStateAction<Set<string>> }
  | { type: 'stopWordsApplied'; words: string[] }
  | { type: 'stopWordsReset' }
  | { type: 'stopWordsLoadingChanged'; active: boolean }
  | { type: 'tokenLimitStateApplied'; limit: number }
  | { type: 'tokenLimitInputChanged'; input: string; clearError?: boolean }
  | { type: 'tokenLimitErrorChanged'; error: string | null }
  | { type: 'tokenLimitApplyingChanged'; active: boolean }
  | { type: 'preferenceErrorsReset' };

/**
 * Creates reducer-owned state for token-frequency preferences.
 * Used by: useTokenFrequencyPreferences hook.
 * Why: because stop-word text/applied filters and token-limit input/error/busy
 * state transition together across backend sync, manual edits, and task results.
 */
export const createTokenFrequencyPreferenceState = (): TokenFrequencyPreferenceState => ({
  stopWords: '',
  isLoadingStopWords: false,
  appliedStopSet: new Set(),
  tokenLimitOverride: null,
  tokenLimitInput: '',
  tokenLimitError: null,
  isApplyingTokenLimit: false,
});

const resolveStateAction = <T>(action: SetStateAction<T>, previous: T): T =>
  typeof action === 'function' ? (action as (current: T) => T)(previous) : action;

/**
 * Reduces token-frequency preference UI state in one place.
 * Used by: useTokenFrequencyPreferences and reducer tests.
 * Flow: stop-word actions keep editor text and the applied Set aligned when
 * filters are applied; token-limit actions keep the displayed input, effective
 * override, validation error, and backend-save spinner aligned.
 */
export const tokenFrequencyPreferenceReducer = (
  state: TokenFrequencyPreferenceState,
  action: TokenFrequencyPreferenceAction,
): TokenFrequencyPreferenceState => {
  switch (action.type) {
    case 'stopWordsChanged':
      return { ...state, stopWords: resolveStateAction(action.value, state.stopWords) };
    case 'appliedStopSetChanged':
      return {
        ...state,
        appliedStopSet: resolveStateAction(action.value, state.appliedStopSet),
      };
    case 'stopWordsApplied':
      return {
        ...state,
        stopWords: formatStopWords(action.words),
        appliedStopSet: new Set(action.words),
      };
    case 'stopWordsReset':
      return { ...state, stopWords: '', appliedStopSet: new Set() };
    case 'stopWordsLoadingChanged':
      return state.isLoadingStopWords === action.active
        ? state
        : { ...state, isLoadingStopWords: action.active };
    case 'tokenLimitStateApplied':
      return {
        ...state,
        tokenLimitOverride: action.limit,
        tokenLimitInput: String(action.limit),
        tokenLimitError: null,
      };
    case 'tokenLimitInputChanged':
      return {
        ...state,
        tokenLimitInput: action.input,
        tokenLimitError: action.clearError ? null : state.tokenLimitError,
      };
    case 'tokenLimitErrorChanged':
      return state.tokenLimitError === action.error
        ? state
        : { ...state, tokenLimitError: action.error };
    case 'tokenLimitApplyingChanged':
      return state.isApplyingTokenLimit === action.active
        ? state
        : { ...state, isApplyingTokenLimit: action.active };
    case 'preferenceErrorsReset':
      return state.tokenLimitError === null ? state : { ...state, tokenLimitError: null };
    default:
      return state;
  }
};
