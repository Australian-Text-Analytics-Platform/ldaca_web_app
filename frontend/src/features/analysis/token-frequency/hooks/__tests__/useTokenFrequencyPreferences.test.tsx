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

describe('useTokenFrequencyPreferences', () => {
  beforeEach(() => {
    defaultStopWordsMock.mockReset();
    postTokenFrequenciesTaskResultMock.mockReset();
  });

  it('requests default stop words for the resolved language', async () => {
    defaultStopWordsMock.mockResolvedValue({ stopwords: ['的', '了', '是'] });

    const setResults = vi.fn();
    const { result } = renderHook(() =>
      useTokenFrequencyPreferences({
        currentWorkspaceId: 'ws-1',
        results: null,
        setResults,
        getAuthHeaders: () => ({ Authorization: 'Bearer test' }),
        resolveTokenFrequencyTaskId: async () => 'task-1',
        defaultStopWordsLanguage: 'zh',
        backendTokenLimit: null,
        backendStopWordsKey: '',
        maxTokenLimitInput: 100,
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
});