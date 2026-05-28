import { useCallback, useEffect, useRef, useState } from 'react';
import { updateTokenFrequenciesTaskResult } from '@/api/generated/sdk.gen';
import type { TokenFrequencyResponse } from '@/api/generated/types.gen';
import { loadMergedStopwords } from '@/lib/loadMergedStopwords';
import { clampDisplayTokenLimit, DEFAULT_TOKEN_LIMIT, toFiniteNumber } from '../../common';

// Multi-language "Apply Stop Words" pours per-language groups into the
// textarea separated by blank lines so users can see which words come
// from which corpus. The parser accepts both commas and newlines as
// separators so that grouped paste / hand edits both survive a round
// trip through ``applyStopSetFromText``. Module-scoped so the regex
// identity is stable across renders.
const STOPWORD_SEPARATOR_RE = /[,\n\r]+/;

type UseTokenFrequencyPreferencesParams = {
  currentWorkspaceId: string | null;
  results: TokenFrequencyResponse | null;
  setResults: React.Dispatch<React.SetStateAction<TokenFrequencyResponse | null>>;
  getAuthHeaders: () => Record<string, string>;
  resolveTokenFrequencyTaskId: () => Promise<string | null>;
  /**
   * Resolved language codes for the currently-selected corpora, one per
    * unique language. "Apply Stop Words" loads all matching local stopword
    * lists and merges them so a multi-language comparison (e.g. EN + ZH)
    * fills both lists at once.
   */
  defaultStopWordsLanguages?: ReadonlyArray<string | null | undefined>;
  backendTokenLimit: number | null;
  backendStopWordsKey: string;
  maxTokenLimitInput: number;
  /** When false, the stopwords / token-limit handlers update local
   * client state only and skip the backend persist roundtrip. Used by
   * the snapshot view: the captured display cap + stopword filter are
   * pure client-side derivations on the captured ``data`` (see
   * ``deriveNodeDisplayResults``), so the user can still interact
   * with these controls in snapshot mode — they just must not mutate
   * the underlying live task's preferences. Defaults to ``true``. */
  persistEnabled?: boolean;
};

export const useTokenFrequencyPreferences = ({
  currentWorkspaceId,
  results,
  setResults,
  getAuthHeaders,
  resolveTokenFrequencyTaskId,
  defaultStopWordsLanguages,
  backendTokenLimit,
  backendStopWordsKey,
  maxTokenLimitInput,
  persistEnabled = true,
}: UseTokenFrequencyPreferencesParams) => {
  const [stopWords, setStopWords] = useState<string>('');
  const [isLoadingStopWords, setIsLoadingStopWords] = useState(false);
  const [appliedStopSet, setAppliedStopSet] = useState<Set<string>>(new Set());
  const [tokenLimitOverride, setTokenLimitOverride] = useState<number | null>(null);
  const [tokenLimitInput, setTokenLimitInput] = useState<string>('');
  const [tokenLimitError, setTokenLimitError] = useState<string | null>(null);
  const [isApplyingTokenLimit, setIsApplyingTokenLimit] = useState(false);

  // Identity stability: used in useEffect dependency array
  const applyTokenLimitState = useCallback((rawLimit: number | null | undefined) => {
    const target = typeof rawLimit === 'number' && Number.isFinite(rawLimit) && rawLimit > 0
      ? rawLimit
      : DEFAULT_TOKEN_LIMIT;
    const { limit: normalizedLimit } = clampDisplayTokenLimit(target);
    const inputLimit = Math.min(normalizedLimit, maxTokenLimitInput);
    setTokenLimitOverride(inputLimit);
    setTokenLimitInput(String(inputLimit));
    setTokenLimitError(null);
  }, [maxTokenLimitInput]);

  useEffect(() => {
    const backendLimit =
      typeof backendTokenLimit === 'number' && Number.isFinite(backendTokenLimit)
        ? backendTokenLimit
        : null;
    let nextLimit: number | null = null;
    if (backendLimit !== null) {
      const { limit: sanitizedBackendLimit } = clampDisplayTokenLimit(backendLimit);
      nextLimit = sanitizedBackendLimit;
    } else if (tokenLimitOverride === null) {
      nextLimit = DEFAULT_TOKEN_LIMIT;
    }

    if (nextLimit !== null) {
      Promise.resolve().then(() => applyTokenLimitState(nextLimit));
    }
  }, [applyTokenLimitState, backendTokenLimit, tokenLimitOverride]);

  useEffect(() => {
    const normalized = backendStopWordsKey
      ? backendStopWordsKey.split('|').filter((word) => word.length > 0)
      : [];

    Promise.resolve().then(() => {
      if (!results) {
        setStopWords('');
        setAppliedStopSet(new Set());
        return;
      }

      setStopWords(normalized.join(', '));
      setAppliedStopSet(new Set(normalized));
    });
  }, [backendStopWordsKey, results]);

  const effectiveTokenLimit = (() => {
    if (typeof tokenLimitOverride === 'number' && Number.isFinite(tokenLimitOverride)) {
      return Math.min(tokenLimitOverride, maxTokenLimitInput);
    }
    if (typeof backendTokenLimit === 'number' && Number.isFinite(backendTokenLimit)) {
      return Math.min(clampDisplayTokenLimit(backendTokenLimit).limit, maxTokenLimitInput);
    }
    return DEFAULT_TOKEN_LIMIT;
  })();

  const persistTokenPreferences = useCallback(
    async (prefs: { token_limit?: number; stop_words?: string[] }) => {
      // Snapshot mode: local state already updated by the caller;
      // skip the backend roundtrip so we don't mutate the live task's
      // saved preferences (or 404 against a nonexistent task).
      if (!persistEnabled) return;
      if (!currentWorkspaceId) return;
      const taskId = await resolveTokenFrequencyTaskId();
      if (!taskId) return;

      const payload: Record<string, unknown> = {};
      if (prefs.token_limit !== undefined) {
        payload.token_limit = Math.min(
          clampDisplayTokenLimit(prefs.token_limit).limit,
          maxTokenLimitInput
        );
      }
      if (prefs.stop_words !== undefined) {
        payload.stop_words = prefs.stop_words;
      }
      if (Object.keys(payload).length === 0) return;

      await updateTokenFrequenciesTaskResult({
        body: payload,
        headers: getAuthHeaders(),
        path: { task_id: taskId },
        throwOnError: true,
      });
    },
    [persistEnabled, currentWorkspaceId, resolveTokenFrequencyTaskId, maxTokenLimitInput, getAuthHeaders],
  );

  const updateResultsPreferencesLocally = useCallback((prefs: { tokenLimit?: number; stopWords?: string[] }) => {
    setResults((prev) => {
      if (!prev) return prev;

      const metadata = { ...((prev.metadata) ?? {}) } as Record<string, unknown>;
      const analysisParams = { ...(prev.analysis_params ?? {}) } as Record<string, unknown>;

      let nextTokenLimit: number | undefined;
      const existingTokenLimit =
        typeof prev.token_limit === 'number' && Number.isFinite(prev.token_limit)
          ? prev.token_limit
          : undefined;
      if (prefs.tokenLimit !== undefined) {
        nextTokenLimit = prefs.tokenLimit;
      } else {
        nextTokenLimit = existingTokenLimit;
      }

      if (nextTokenLimit !== undefined && Number.isFinite(nextTokenLimit)) {
        const { limit: normalizedLimit } = clampDisplayTokenLimit(nextTokenLimit);
        const inputLimit = Math.min(normalizedLimit, maxTokenLimitInput);
        metadata.token_limit = inputLimit;
        analysisParams.token_limit = inputLimit;
        nextTokenLimit = inputLimit;
      }

      delete metadata.limit;
      delete analysisParams.limit;

      const stopWordsArray =
        prefs.stopWords !== undefined
          ? prefs.stopWords
          : Array.isArray(prev.stop_words)
          ? prev.stop_words
          : Array.isArray(metadata.stop_words)
          ? metadata.stop_words
          : [];

      metadata.stop_words = stopWordsArray;
      analysisParams.stop_words = stopWordsArray;

      return {
        ...prev,
        token_limit: nextTokenLimit ?? undefined,
        analysis_params: analysisParams,
        metadata,
        stop_words: stopWordsArray,
        message: prev.message,
        state: prev.state,
      } as TokenFrequencyResponse;
    });
  }, [setResults, maxTokenLimitInput]);

  const applyTokenLimitWithValidation = async () => {
    const parsed = toFiniteNumber(tokenLimitInput);
    if (parsed === null) {
      setTokenLimitError('Enter a whole number greater than zero.');
      return;
    }

    const normalized = Math.floor(parsed);
    if (!Number.isFinite(normalized) || normalized <= 0) {
      setTokenLimitError('Enter a whole number greater than zero.');
      return;
    }

    const { limit: normalizedLimit } = clampDisplayTokenLimit(normalized);
    const targetLimit = Math.min(normalizedLimit, maxTokenLimitInput);
    if (normalizedLimit > maxTokenLimitInput) {
      setTokenLimitInput(String(maxTokenLimitInput));
    }

    setTokenLimitError(null);

    const limitChanged = targetLimit !== effectiveTokenLimit;
    if (!results || !limitChanged) {
      applyTokenLimitState(targetLimit);
      return;
    }

    setIsApplyingTokenLimit(true);
    try {
      await persistTokenPreferences({ token_limit: targetLimit });
      updateResultsPreferencesLocally({ tokenLimit: targetLimit });
      applyTokenLimitState(targetLimit);
    } catch (error) {
      console.error('Failed to update token limit', error);
      setTokenLimitError('Failed to update token limit. Please try again.');
    } finally {
      setIsApplyingTokenLimit(false);
    }
  };

  const saveStopWordsToBackend = useCallback(
    async (words: string[]) => {
      try {
        await persistTokenPreferences({ stop_words: words });
        updateResultsPreferencesLocally({ stopWords: words });
      } catch (error) {
        console.warn('Failed to save stop words', error);
      }
    },
    [persistTokenPreferences, updateResultsPreferencesLocally],
  );

  // Ref-pattern so this callback can read the *current* saveStopWordsToBackend
  // without becoming unstable itself. Keeping the returned callback stable
  // across renders matters because it propagates through the task-flow hook's
  // right-click handler down to React.memo'd word-cloud sections; if it
  // churned per render the cloud would re-run d3-cloud layout on every
  // stopword-textarea keystroke.
  const saveStopWordsToBackendRef = useRef(saveStopWordsToBackend);
  useEffect(() => {
    saveStopWordsToBackendRef.current = saveStopWordsToBackend;
  }, [saveStopWordsToBackend]);

  const applyStopSetFromText = useCallback((text: string) => {
    const words = text
      .split(STOPWORD_SEPARATOR_RE)
      .map((word) => word.trim().toLowerCase())
      .filter(Boolean);
    setStopWords(words.join(', '));
    setAppliedStopSet(new Set(words));
    void saveStopWordsToBackendRef.current(words);
  }, [setStopWords, setAppliedStopSet]);

  const sortStopWords = () => {
    const words = stopWords
      .split(STOPWORD_SEPARATOR_RE)
      .map((word) => word.trim().toLowerCase())
      .filter(Boolean);
    words.sort((a, b) => a.localeCompare(b));
    const sorted = words.join(', ');
    setStopWords(sorted);
    setAppliedStopSet(new Set(words));
    void saveStopWordsToBackend(words);
  };

  const handleTokenLimitInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const raw = event.target.value;

    if (!raw) {
      setTokenLimitInput(raw);
      if (tokenLimitError) setTokenLimitError(null);
      return;
    }

    const parsed = toFiniteNumber(raw);
    if (parsed !== null) {
      const floored = Math.floor(parsed);
      if (Number.isFinite(floored) && floored > maxTokenLimitInput) {
        setTokenLimitInput(String(maxTokenLimitInput));
        if (tokenLimitError) setTokenLimitError(null);
        return;
      }
    }

    setTokenLimitInput(raw);
    if (tokenLimitError) setTokenLimitError(null);
  };

  const handleTokenLimitBlur = () => {
    void applyTokenLimitWithValidation();
  };

  // Programmatically apply a numeric cloud-side token limit (used by the
  // separate "List display limit" control in the panel: changes there cap
  // the cloud limit at 100, and we want that to flow through the same
  // persistence + state path as the cloud input itself).
  const applyTokenLimit = async (value: number) => {
    if (!Number.isFinite(value) || value <= 0) return;
    const { limit: normalizedLimit } = clampDisplayTokenLimit(Math.floor(value));
    const targetLimit = Math.min(normalizedLimit, maxTokenLimitInput);
    setTokenLimitInput(String(targetLimit));
    setTokenLimitError(null);
    if (targetLimit === effectiveTokenLimit) {
      applyTokenLimitState(targetLimit);
      return;
    }
    if (!results) {
      applyTokenLimitState(targetLimit);
      return;
    }
    setIsApplyingTokenLimit(true);
    try {
      await persistTokenPreferences({ token_limit: targetLimit });
      updateResultsPreferencesLocally({ tokenLimit: targetLimit });
      applyTokenLimitState(targetLimit);
    } catch (error) {
      console.error('Failed to update token limit', error);
      setTokenLimitError('Failed to update token limit. Please try again.');
    } finally {
      setIsApplyingTokenLimit(false);
    }
  };

  const handleFillDefaultStopWords = async () => {
    setIsLoadingStopWords(true);
    try {
      const hasLanguages =
        Array.isArray(defaultStopWordsLanguages) &&
        defaultStopWordsLanguages.length > 0;

      if (!hasLanguages) {
        console.error('Default stop words require at least one resolved language');
        return;
      }

      const { byLanguage, merged } = await loadMergedStopwords({
        languages: defaultStopWordsLanguages!,
      });
      if (merged.length === 0) {
        console.error('Default stop words returned an empty list');
        return;
      }
      const grouped = byLanguage
        .filter((group) => group.words.length > 0)
        .map((group) => group.words.join(', '))
        .join('\n\n');
      const display = grouped || merged.join(', ');

      setStopWords(display);
      applyStopSetFromText(display);
    } catch (error) {
      console.error('Error getting default stop words:', error);
    } finally {
      setIsLoadingStopWords(false);
    }
  };

  const resetPreferenceUiState = () => {
    setTokenLimitError(null);
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
    handleFillDefaultStopWords,
    persistTokenPreferences,
    resetPreferenceUiState,
  };
};
