import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useTokenFrequencyPreferences } from '../useTokenFrequencyPreferences';

const {
  getDefaultStopWordsMock,
  updateTokenFrequenciesTaskResultMock,
} = vi.hoisted(() => ({
  getDefaultStopWordsMock: vi.fn(),
  updateTokenFrequenciesTaskResultMock: vi.fn(),
}));

vi.mock('@/api/generated/sdk.gen', () => ({
  getDefaultStopWords: getDefaultStopWordsMock,
  updateTokenFrequenciesTaskResult: updateTokenFrequenciesTaskResultMock,
}));

const baseArgs = {
  currentWorkspaceId: 'ws-1',
  results: null,
  setResults: vi.fn(),
  getAuthHeaders: () => ({ Authorization: 'Bearer test' }),
  resolveTokenFrequencyTaskId: async () => 'task-1',
  backendTokenLimit: null,
  backendStopWordsKey: '',
  maxTokenLimitInput: 100,
};

describe('useTokenFrequencyPreferences', () => {
  beforeEach(() => {
    getDefaultStopWordsMock.mockReset();
    updateTokenFrequenciesTaskResultMock.mockReset();
  });

  it('requests default stop words for a single resolved language', async () => {
    getDefaultStopWordsMock.mockResolvedValue({ data: { stopwords: ['的', '了', '是'] }, error: undefined });

    const { result } = renderHook(() =>
      useTokenFrequencyPreferences({
        ...baseArgs,
        defaultStopWordsLanguages: ['zh'],
      }),
    );

    await act(async () => {
      await result.current.handleFillDefaultStopWords();
    });

    await waitFor(() => {
      expect(getDefaultStopWordsMock).toHaveBeenCalledWith({
        headers: { Authorization: 'Bearer test' },
        query: { language: 'zh', strict: true },
        throwOnError: true,
      });
    });

    expect(result.current.stopWords).toBe('的, 了, 是');
  });

  it('does not request default stop words when no languages are resolved', async () => {
    getDefaultStopWordsMock.mockResolvedValue({ data: { stopwords: ['the', 'and', 'of'] }, error: undefined });

    const { result } = renderHook(() =>
      useTokenFrequencyPreferences({
        ...baseArgs,
        defaultStopWordsLanguages: [],
      }),
    );

    await act(async () => {
      await result.current.handleFillDefaultStopWords();
    });

    expect(getDefaultStopWordsMock).not.toHaveBeenCalled();
    expect(result.current.stopWords).toBe('');
  });

  it('merges per-language groups when multiple languages are requested', async () => {
    getDefaultStopWordsMock.mockImplementation(
      (options?: { query?: { language?: string; strict?: boolean } }) => {
        if (options?.query?.language === 'en') {
          return Promise.resolve({ data: { stopwords: ['the', 'and', 'of'] }, error: undefined });
        }
        if (options?.query?.language === 'zh') {
          return Promise.resolve({ data: { stopwords: ['的', '了', '是'] }, error: undefined });
        }
        return Promise.resolve({ data: { stopwords: [] }, error: undefined });
      },
    );

    const { result } = renderHook(() =>
      useTokenFrequencyPreferences({
        ...baseArgs,
        defaultStopWordsLanguages: ['en', 'zh'],
      }),
    );

    await act(async () => {
      await result.current.handleFillDefaultStopWords();
    });

    await waitFor(() => {
      expect(getDefaultStopWordsMock).toHaveBeenCalledWith({
        headers: { Authorization: 'Bearer test' },
        query: { language: 'en', strict: true },
        throwOnError: true,
      });
    });
    expect(getDefaultStopWordsMock).toHaveBeenCalledWith({
      headers: { Authorization: 'Bearer test' },
      query: { language: 'zh', strict: true },
      throwOnError: true,
    });

    // The hook builds groups separated by ``\n\n`` for visual clarity,
    // then ``applyStopSetFromText`` normalises through the new
    // comma-or-newline parser into the canonical flat ``", "``-joined
    // form. Both EN and ZH entries survive the round-trip.
    expect(result.current.stopWords).toBe('the, and, of, 的, 了, 是');
  });
});
