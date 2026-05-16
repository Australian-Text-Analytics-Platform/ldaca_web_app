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

vi.mock('@/api/text', () => ({
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
        { language: 'zh' },
      );
    });

    expect(result.current.stopWords).toBe('的, 了, 是');
  });

  it('falls back to a no-language request when no languages are resolved', async () => {
    defaultStopWordsMock.mockResolvedValue({ stopwords: ['the', 'and', 'of'] });

    const { result } = renderHook(() =>
      useTokenFrequencyPreferences({
        ...baseArgs,
        // Empty list — feature couldn't infer a language. Hook should
        // still request the legacy default (English-backed via the
        // endpoint's non-strict fallback).
        defaultStopWordsLanguages: [],
      }),
    );

    await act(async () => {
      await result.current.handleFillDefaultStopWords();
    });

    await waitFor(() => {
      expect(defaultStopWordsMock).toHaveBeenCalledWith(
        { Authorization: 'Bearer test' },
        { language: undefined },
      );
    });

    expect(result.current.stopWords).toBe('the, and, of');
  });

  it('merges per-language groups when multiple languages are requested', async () => {
    defaultStopWordsMock.mockImplementation(
      (_headers: unknown, options?: { language?: string }) => {
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
        { language: 'en' },
      );
    });
    expect(defaultStopWordsMock).toHaveBeenCalledWith(
      { Authorization: 'Bearer test' },
      { language: 'zh' },
    );

    // The hook builds groups separated by ``\n\n`` for visual clarity,
    // then ``applyStopSetFromText`` normalises through the new
    // comma-or-newline parser into the canonical flat ``", "``-joined
    // form. Both EN and ZH entries survive the round-trip.
    expect(result.current.stopWords).toBe('the, and, of, 的, 了, 是');
  });
});
