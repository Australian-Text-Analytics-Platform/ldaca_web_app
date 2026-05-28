import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useTokenFrequencyPreferences } from '../useTokenFrequencyPreferences';

const {
  updateTokenFrequenciesTaskResultMock,
} = vi.hoisted(() => ({
  updateTokenFrequenciesTaskResultMock: vi.fn(),
}));

vi.mock('@/api/generated/sdk.gen', () => ({
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
    updateTokenFrequenciesTaskResultMock.mockReset();
  });

  it('fills default stop words for a single resolved language', async () => {
    const { result } = renderHook(() =>
      useTokenFrequencyPreferences({
        ...baseArgs,
        defaultStopWordsLanguages: ['zh'],
      }),
    );

    await act(async () => {
      await result.current.handleFillDefaultStopWords();
    });

    await waitFor(() => expect(result.current.stopWords).toContain('的'));
  });

  it('does not fill default stop words when no languages are resolved', async () => {
    const { result } = renderHook(() =>
      useTokenFrequencyPreferences({
        ...baseArgs,
        defaultStopWordsLanguages: [],
      }),
    );

    await act(async () => {
      await result.current.handleFillDefaultStopWords();
    });

    expect(result.current.stopWords).toBe('');
  });

  it('merges per-language groups when multiple languages are requested', async () => {
    const { result } = renderHook(() =>
      useTokenFrequencyPreferences({
        ...baseArgs,
        defaultStopWordsLanguages: ['en', 'zh'],
      }),
    );

    await act(async () => {
      await result.current.handleFillDefaultStopWords();
    });

    // The hook builds groups separated by ``\n\n`` for visual clarity,
    // then ``applyStopSetFromText`` normalises into the canonical flat
    // ``, ``-joined form. Both EN and ZH entries survive the round-trip.
    await waitFor(() => expect(result.current.stopWords).toContain('about'));
    expect(result.current.stopWords).toContain('的');
  });
});
