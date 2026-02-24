import { useCallback, useEffect, useState } from 'react';
import type { TokenFrequencyResponse } from '@/api/text';
import { textApi } from '@/api/text';
import { clampDisplayTokenLimit, DEFAULT_TOKEN_LIMIT, toFiniteNumber } from '../../common';

type UseTokenFrequencyPreferencesParams = {
  currentWorkspaceId: string | null;
  results: TokenFrequencyResponse | null;
  setResults: React.Dispatch<React.SetStateAction<TokenFrequencyResponse | null>>;
  getAuthHeaders: () => Record<string, string>;
  resolveTokenFrequencyTaskId: () => Promise<string | null>;
  backendTokenLimit: number | null;
  backendStopWordsKey: string;
  maxTokenLimitInput: number;
};

export const useTokenFrequencyPreferences = ({
  currentWorkspaceId,
  results,
  setResults,
  getAuthHeaders,
  resolveTokenFrequencyTaskId,
  backendTokenLimit,
  backendStopWordsKey,
  maxTokenLimitInput,
}: UseTokenFrequencyPreferencesParams) => {
  const [stopWords, setStopWords] = useState<string>('');
  const [isLoadingStopWords, setIsLoadingStopWords] = useState(false);
  const [appliedStopSet, setAppliedStopSet] = useState<Set<string>>(new Set());
  const [tokenLimitOverride, setTokenLimitOverride] = useState<number | null>(null);
  const [tokenLimitInput, setTokenLimitInput] = useState<string>('');
  const [tokenLimitError, setTokenLimitError] = useState<string | null>(null);
  const [isApplyingTokenLimit, setIsApplyingTokenLimit] = useState(false);

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
    if (backendLimit !== null) {
      const { limit: sanitizedBackendLimit } = clampDisplayTokenLimit(backendLimit);
      applyTokenLimitState(sanitizedBackendLimit);
    } else if (tokenLimitOverride === null) {
      applyTokenLimitState(DEFAULT_TOKEN_LIMIT);
    }
  }, [applyTokenLimitState, backendTokenLimit, tokenLimitOverride]);

  useEffect(() => {
    if (!results) {
      setStopWords('');
      setAppliedStopSet(new Set());
      return;
    }

    const normalized = backendStopWordsKey
      ? backendStopWordsKey.split('|').filter((word) => word.length > 0)
      : [];
    const joined = normalized.join(', ');
    setStopWords(joined);
    setAppliedStopSet(new Set(normalized));
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
      if (!currentWorkspaceId) return;
      const taskId = await resolveTokenFrequencyTaskId();
      if (!taskId) return;

      const payload: Record<string, any> = {};
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

      await textApi.postTokenFrequenciesTaskResult(taskId, payload, getAuthHeaders());
    },
    [currentWorkspaceId, getAuthHeaders, maxTokenLimitInput, resolveTokenFrequencyTaskId]
  );

  const updateResultsPreferencesLocally = useCallback(
    (prefs: { tokenLimit?: number; stopWords?: string[] }) => {
      setResults((prev) => {
        if (!prev) return prev;

        const metadata = { ...(((prev as any)?.metadata) ?? {}) } as Record<string, any>;
        const analysisParams = { ...(prev.analysis_params ?? {}) } as Record<string, any>;

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
    },
    [maxTokenLimitInput, setResults]
  );

  const applyTokenLimitWithValidation = useCallback(async () => {
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
  }, [
    applyTokenLimitState,
    effectiveTokenLimit,
    maxTokenLimitInput,
    persistTokenPreferences,
    results,
    tokenLimitInput,
    updateResultsPreferencesLocally,
  ]);

  const saveStopWordsToBackend = useCallback(
    async (words: string[]) => {
      try {
        await persistTokenPreferences({ stop_words: words });
        updateResultsPreferencesLocally({ stopWords: words });
      } catch (error) {
        console.warn('Failed to save stop words', error);
      }
    },
    [persistTokenPreferences, updateResultsPreferencesLocally]
  );

  const applyStopSetFromText = useCallback(
    (text: string) => {
      const words = text
        .split(',')
        .map((word) => word.trim().toLowerCase())
        .filter(Boolean);
      setStopWords(words.join(', '));
      setAppliedStopSet(new Set(words));
      void saveStopWordsToBackend(words);
    },
    [saveStopWordsToBackend]
  );

  const handleTokenLimitInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
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
  }, [maxTokenLimitInput, tokenLimitError]);

  const handleTokenLimitBlur = useCallback(() => {
    void applyTokenLimitWithValidation();
  }, [applyTokenLimitWithValidation]);

  const handleTokenLimitKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void applyTokenLimitWithValidation();
    }
  }, [applyTokenLimitWithValidation]);

  const handleFillDefaultStopWords = useCallback(async () => {
    setIsLoadingStopWords(true);
    try {
      const response = await textApi.defaultStopWords(getAuthHeaders());
      const defaultWords = response?.stopwords ?? (response as any)?.data;
      if (Array.isArray(defaultWords) && defaultWords.length) {
        const joined = defaultWords.join(', ');
        setStopWords(joined);
        applyStopSetFromText(joined);
      } else {
        console.error('Failed to get default stop words:', response);
      }
    } catch (error) {
      console.error('Error getting default stop words:', error);
    } finally {
      setIsLoadingStopWords(false);
    }
  }, [applyStopSetFromText, getAuthHeaders]);

  const resetPreferenceUiState = useCallback(() => {
    setTokenLimitError(null);
  }, []);

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
    handleTokenLimitInputChange,
    handleTokenLimitBlur,
    handleTokenLimitKeyDown,
    handleFillDefaultStopWords,
    persistTokenPreferences,
    resetPreferenceUiState,
  };
};
