import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useTokenFrequencyPreferences } from '../useTokenFrequencyPreferences';

const {
  defaultStopWordsMock,
  postTokenFrequenciesTaskResultMock,
} = vi.hoisted(() => ({
  defaultStopWordsMock: vi.fn(),
  postTokenFrequenciesTaskResultMock: vi.fn(),
}));

vi.mock('@/lib/backend/text', () => ({
  textApi: {
    defaultStopWords: defaultStopWordsMock,
    postTokenFrequenciesTaskResult: postTokenFrequenciesTaskResultMock,
  },
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
    defaultStopWordsMock.mockReset();
    postTokenFrequenciesTaskResultMock.mockReset();
  });

  it('requests default stop words for a single resolved language', async () => {
    defaultStopWordsMock.mockResolvedValue({ stopwords: ['的', '了', '是'] });

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
      expect(defaultStopWordsMock).toHaveBeenCalledWith(
        { Authorization: 'Bearer test' },
        { language: 'zh', strict: true },
      );
    });

    expect(result.current.stopWords).toBe('的, 了, 是');
  });

  it('does not request default stop words when no languages are resolved', async () => {
    defaultStopWordsMock.mockResolvedValue({ stopwords: ['the', 'and', 'of'] });

    const { result } = renderHook(() =>
      useTokenFrequencyPreferences({
        ...baseArgs,
        defaultStopWordsLanguages: [],
      }),
    );

    await act(async () => {
      await result.current.handleFillDefaultStopWords();
    });

    expect(defaultStopWordsMock).not.toHaveBeenCalled();
    expect(result.current.stopWords).toBe('');
  });

  it('merges per-language groups when multiple languages are requested', async () => {
    defaultStopWordsMock.mockImplementation(
      (_headers: unknown, options?: { language?: string; strict?: boolean }) => {
        if (options?.language === 'en') {
          return Promise.resolve({ stopwords: ['the', 'and', 'of'] });
        }
        if (options?.language === 'zh') {
          return Promise.resolve({ stopwords: ['的', '了', '是'] });
        }
        return Promise.resolve({ stopwords: [] });
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
      expect(defaultStopWordsMock).toHaveBeenCalledWith(
        { Authorization: 'Bearer test' },
        { language: 'en', strict: true },
      );
    });
    expect(defaultStopWordsMock).toHaveBeenCalledWith(
      { Authorization: 'Bearer test' },
      { language: 'zh', strict: true },
    );

    // The hook builds groups separated by ``\n\n`` for visual clarity,
    // then ``applyStopSetFromText`` normalises through the new
    // comma-or-newline parser into the canonical flat ``", "``-joined
    // form. Both EN and ZH entries survive the round-trip.
    expect(result.current.stopWords).toBe('the, and, of, 的, 了, 是');
  });
});
