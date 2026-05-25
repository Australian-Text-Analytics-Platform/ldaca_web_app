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

  it('keeps a user-set token limit in snapshot mode (persistEnabled=false)', async () => {
    // Snapshot mode: ``results`` comes from the frozen snapshot payload
    // in the feature; ``setResults`` writes to a different (live) state
    // that doesn't feed back into ``backendTokenLimit`` here. Before
    // the resync gate was added, the input snapped back to the
    // captured ``backendTokenLimit`` on every override change.
    //
    // Stable ``results`` reference: a separate useEffect inside the
    // hook depends on ``results`` and calls ``setAppliedStopSet(new
    // Set())``, which creates a fresh Set each render. If the test
    // passed a new object literal on every renderHook render, that
    // effect would re-fire forever and OOM the worker.
    const frozenResults = { state: 'successful', token_limit: 100 } as unknown as Parameters<
      typeof useTokenFrequencyPreferences
    >[0]['results'];
    const { result } = renderHook(() =>
      useTokenFrequencyPreferences({
        ...baseArgs,
        results: frozenResults,
        backendTokenLimit: 100,
        persistEnabled: false,
      }),
    );

    // Initial sync from backend.
    await waitFor(() => {
      expect(result.current.tokenLimitInput).toBe('100');
    });

    await act(async () => {
      await result.current.applyTokenLimit(50);
    });

    // The user's override should stick — backend was not (and cannot be)
    // updated to 50 in snapshot mode, so the resync effect must not
    // overwrite it back to 100.
    expect(result.current.tokenLimitInput).toBe('50');
    expect(result.current.effectiveTokenLimit).toBe(50);
    expect(postTokenFrequenciesTaskResultMock).not.toHaveBeenCalled();
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
