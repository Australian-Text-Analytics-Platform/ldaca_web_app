import { useCallback, useEffect, useReducer } from 'react';
import type { TokenFrequencyResponse } from '@/api';
import { loadMergedStopwords } from '@/lib/loadMergedStopwords';
import { clampDisplayTokenLimit, DEFAULT_TOKEN_LIMIT, toFiniteNumber } from '../../common/utils';
import {
  formatStopWords,
  mergeStopWordsText,
  parseStopWordsText,
} from '../tokenFrequencyStopWords';
import {
  createTokenFrequencyPreferenceState,
  tokenFrequencyPreferenceReducer,
} from './tokenFrequencyPreferenceState';

interface UseTokenFrequencyPreferencesParams {
  results: TokenFrequencyResponse | null;
  backendTokenLimit: number | null;
  backendStopWordsKey: string;
  maxTokenLimitInput: number;
  savedTokenLimit?: number;
  savedStopWordsJson?: string;
  onTokenLimitChange?: (value: number) => void;
  onStopWordsChange?: (words: string[]) => void;
}

/** Owns token-frequency preference UI state and persistence for stop words and display limits. */
/**
 * Used by `TokenFrequencyFeature`; focused hook tests cover local preference
 * parsing and persistence behavior.
 * Flow: synchronize backend preferences into reducer state, persist validated
 * updates to the active task, patch the displayed result, and expose UI handlers.
 */
export const useTokenFrequencyPreferences = ({
  results,
  backendTokenLimit,
  backendStopWordsKey,
  maxTokenLimitInput,
  savedTokenLimit,
  savedStopWordsJson,
  onTokenLimitChange,
  onStopWordsChange,
}: UseTokenFrequencyPreferencesParams) => {
  const [preferenceState, dispatchPreference] = useReducer(
    tokenFrequencyPreferenceReducer,
    undefined,
    createTokenFrequencyPreferenceState,
  );
  const {
    stopWords,
    isLoadingStopWords,
    appliedStopSet,
    tokenLimitOverride,
    tokenLimitInput,
    tokenLimitError,
    isApplyingTokenLimit,
  } = preferenceState;

  const setStopWords = useCallback((value: React.SetStateAction<string>) => {
    dispatchPreference({ type: 'stopWordsChanged', value });
  }, []);

  const setAppliedStopSet = useCallback((value: React.SetStateAction<Set<string>>) => {
    dispatchPreference({ type: 'appliedStopSetChanged', value });
  }, []);

  // Identity stability: used in useEffect dependency array
  const applyTokenLimitState = useCallback(
    (rawLimit: number | null | undefined) => {
      const target =
        typeof rawLimit === 'number' && Number.isFinite(rawLimit) && rawLimit > 0
          ? rawLimit
          : DEFAULT_TOKEN_LIMIT;
      const { limit: normalizedLimit } = clampDisplayTokenLimit(target);
      const inputLimit = Math.min(normalizedLimit, maxTokenLimitInput);
      dispatchPreference({ type: 'tokenLimitStateApplied', limit: inputLimit });
    },
    [maxTokenLimitInput],
  );

  useEffect(() => {
    const persistedLimit =
      typeof savedTokenLimit === 'number' && Number.isFinite(savedTokenLimit)
        ? savedTokenLimit
        : null;
    const backendLimit =
      persistedLimit ??
      (typeof backendTokenLimit === 'number' && Number.isFinite(backendTokenLimit)
        ? backendTokenLimit
        : null);
    let nextLimit: number | null = null;
    if (backendLimit !== null) {
      const { limit: sanitizedBackendLimit } = clampDisplayTokenLimit(backendLimit);
      nextLimit = sanitizedBackendLimit;
    } else if (tokenLimitOverride === null) {
      nextLimit = DEFAULT_TOKEN_LIMIT;
    }

    if (nextLimit !== null) {
      void Promise.resolve().then(() => {
        applyTokenLimitState(nextLimit);
      });
    }
  }, [applyTokenLimitState, backendTokenLimit, savedTokenLimit, tokenLimitOverride]);

  useEffect(() => {
    let savedStopWords: string[] | null = null;
    if (savedStopWordsJson) {
      try {
        const parsed: unknown = JSON.parse(savedStopWordsJson);
        if (Array.isArray(parsed) && parsed.every((word) => typeof word === 'string')) {
          savedStopWords = parsed;
        }
      } catch {
        savedStopWords = null;
      }
    }
    const normalized =
      savedStopWords ??
      (backendStopWordsKey ? backendStopWordsKey.split('|').filter((word) => word.length > 0) : []);

    void Promise.resolve().then(() => {
      if (!results) {
        dispatchPreference({ type: 'stopWordsReset' });
        return;
      }

      dispatchPreference({ type: 'stopWordsApplied', words: normalized });
    });
  }, [backendStopWordsKey, results, savedStopWordsJson]);

  const effectiveTokenLimit = (() => {
    if (typeof tokenLimitOverride === 'number' && Number.isFinite(tokenLimitOverride)) {
      return Math.min(tokenLimitOverride, maxTokenLimitInput);
    }
    if (typeof savedTokenLimit === 'number' && Number.isFinite(savedTokenLimit)) {
      return Math.min(clampDisplayTokenLimit(savedTokenLimit).limit, maxTokenLimitInput);
    }
    if (typeof backendTokenLimit === 'number' && Number.isFinite(backendTokenLimit)) {
      return Math.min(clampDisplayTokenLimit(backendTokenLimit).limit, maxTokenLimitInput);
    }
    return DEFAULT_TOKEN_LIMIT;
  })();

  /**
   * Apply one already-normalized token limit locally and persist it when live
   * results own server preferences.
   * Called by: typed-input validation and the programmatic list-limit handler,
   * which differ only in how they normalize user input. This keeps persistence,
   * optimistic result metadata, loading state, and failure copy in one path.
   */
  const persistAndApplyTokenLimit = (targetLimit: number) => {
    if (!results || targetLimit === effectiveTokenLimit) {
      applyTokenLimitState(targetLimit);
      return;
    }

    dispatchPreference({ type: 'tokenLimitApplyingChanged', active: true });
    try {
      applyTokenLimitState(targetLimit);
      onTokenLimitChange?.(targetLimit);
    } catch (error) {
      console.error('Failed to update token limit', error);
      dispatchPreference({
        type: 'tokenLimitErrorChanged',
        error: 'Failed to update token limit. Please try again.',
      });
    } finally {
      dispatchPreference({ type: 'tokenLimitApplyingChanged', active: false });
    }
  };

  /** Validates and persists the cloud display limit entered in the parameter UI. */
  /**
   * Called by preference handlers in `useTokenFrequencyPreferences`.
   * Flow: parse and clamp the input, short-circuit unchanged/local-only state,
   * otherwise persist the limit and apply it to reducer and result metadata.
   */
  const applyTokenLimitWithValidation = () => {
    const parsed = toFiniteNumber(tokenLimitInput);
    if (parsed === null) {
      dispatchPreference({
        type: 'tokenLimitErrorChanged',
        error: 'Enter a whole number greater than zero.',
      });
      return;
    }

    const normalized = Math.floor(parsed);
    if (!Number.isFinite(normalized) || normalized <= 0) {
      dispatchPreference({
        type: 'tokenLimitErrorChanged',
        error: 'Enter a whole number greater than zero.',
      });
      return;
    }

    const { limit: normalizedLimit } = clampDisplayTokenLimit(normalized);
    const targetLimit = Math.min(normalizedLimit, maxTokenLimitInput);
    if (normalizedLimit > maxTokenLimitInput) {
      dispatchPreference({
        type: 'tokenLimitInputChanged',
        input: String(maxTokenLimitInput),
        clearError: true,
      });
    }

    dispatchPreference({ type: 'tokenLimitErrorChanged', error: null });

    persistAndApplyTokenLimit(targetLimit);
  };

  const applyStopSetFromText = useCallback(
    (text: string) => {
      const words = parseStopWordsText(text);
      dispatchPreference({ type: 'stopWordsApplied', words });
      if (results) onStopWordsChange?.(words);
    },
    [onStopWordsChange, results],
  );

  /** Sorts the current stop-word text so users can review and export a stable list. */
  /**
   * Called by preference handlers in `useTokenFrequencyPreferences`.
   */
  const sortStopWords = () => {
    const words = parseStopWordsText(stopWords);
    words.sort((a, b) => a.localeCompare(b));
    dispatchPreference({ type: 'stopWordsApplied', words });
    if (results) onStopWordsChange?.(words);
  };

  /** Mirrors token-limit keystrokes into state while clearing stale validation errors. */
  /**
   * Returned to `TokenFrequencyFeature` by `useTokenFrequencyPreferences`.
   * Flow: accept empty input, clamp over-limit numeric edits to the max, mirror raw text state, then clear stale validation errors.
   */
  const handleTokenLimitInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const raw = event.target.value;

    if (!raw) {
      dispatchPreference({ type: 'tokenLimitInputChanged', input: raw, clearError: true });
      return;
    }

    const parsed = toFiniteNumber(raw);
    if (parsed !== null) {
      const floored = Math.floor(parsed);
      if (Number.isFinite(floored) && floored > maxTokenLimitInput) {
        dispatchPreference({
          type: 'tokenLimitInputChanged',
          input: String(maxTokenLimitInput),
          clearError: true,
        });
        return;
      }
    }

    dispatchPreference({ type: 'tokenLimitInputChanged', input: raw, clearError: true });
  };

  /** Applies token-limit validation when the numeric input loses focus. */
  /**
   * Returned to `TokenFrequencyFeature` by `useTokenFrequencyPreferences`.
   */
  const handleTokenLimitBlur = () => {
    applyTokenLimitWithValidation();
  };

  // Programmatically apply a numeric cloud-side token limit (used by the
  // separate "List display limit" control in the panel: changes there cap
  // the cloud limit at 100, and we want that to flow through the same
  // persistence + state path as the cloud input itself).
  /**
   * Called by preference handlers in `useTokenFrequencyPreferences`.
   * Flow: normalize and cap the requested limit, update local input/error state, persist when results exist and value changed, then mirror preferences locally.
   */
  const applyTokenLimit = (value: number) => {
    if (!Number.isFinite(value) || value <= 0) return;
    const { limit: normalizedLimit } = clampDisplayTokenLimit(Math.floor(value));
    const targetLimit = Math.min(normalizedLimit, maxTokenLimitInput);
    dispatchPreference({
      type: 'tokenLimitInputChanged',
      input: String(targetLimit),
      clearError: true,
    });
    persistAndApplyTokenLimit(targetLimit);
  };

  /** Adds a chosen language's default stop words to the existing editable list. */
  /**
   * Called by: TokenFrequencyFeature via FillDefaultStopWordsDialog's onFill,
   * because language is picked per scenario in the dialog rather than derived
   * from a stored per-column property.
   * Flow: load the chosen language's default stop words, append them to whatever
   * is already in the editor, then apply the combined set. Appending (instead of
   * replacing) lets users stack stop-word bags from multiple languages; the
   * dedupe in applyStopSetFromText keeps overlaps from piling up.
   */
  const handleAddDefaultStopWords = async (language: string) => {
    if (!language) {
      throw new Error('Default stop words require a language selection');
    }
    dispatchPreference({ type: 'stopWordsLoadingChanged', active: true });
    try {
      const { merged } = await loadMergedStopwords({
        languages: [language],
      });
      if (merged.length === 0) {
        throw new Error('Default stop words returned an empty list');
      }
      applyStopSetFromText(formatStopWords(mergeStopWordsText(stopWords, merged)));
    } catch (error) {
      console.error('Error getting default stop words:', error);
      throw error;
    } finally {
      dispatchPreference({ type: 'stopWordsLoadingChanged', active: false });
    }
  };

  /** Resets transient preference errors when results or selection state are cleared. */
  /**
   * Called by preference handlers in `useTokenFrequencyPreferences`.
   */
  const resetPreferenceUiState = () => {
    dispatchPreference({ type: 'preferenceErrorsReset' });
  };

  return {
    stopWords,
    setStopWords,
    isLoadingStopWords,
    appliedStopSet,
    setAppliedStopSet,
    tokenLimitInput,
    tokenLimitError,
    isApplyingTokenLimit,
    effectiveTokenLimit,
    applyTokenLimitState,
    applyStopSetFromText,
    sortStopWords,
    handleTokenLimitInputChange,
    handleTokenLimitBlur,
    applyTokenLimit,
    handleAddDefaultStopWords,
    resetPreferenceUiState,
  };
};
