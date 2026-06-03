import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useTokenFrequencyPreferences } from '../useTokenFrequencyPreferences';

const { updateTokenFrequenciesTaskResultMock } = vi.hoisted(() => ({
  updateTokenFrequenciesTaskResultMock: vi.fn(),
}));

vi.mock('@/api/generated/sdk.gen', () => ({
  updateTokenFrequenciesTaskResult: updateTokenFrequenciesTaskResultMock,
}));

/** Provides the default hook arguments shared across preference tests. */
/**
 * Consumed by: the Vitest cases in this file as the callback map for this analysis workflow because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
 */
const baseArgs = {
  currentWorkspaceId: 'ws-1',
  results: null,
  setResults: vi.fn(),
  /** Supplies deterministic auth headers for generated API calls. */
  // Called by: the Vitest cases in this file through its owning hook, JSX prop, or analysis lifecycle config because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
  getAuthHeaders: () => ({ Authorization: 'Bearer test' }),
  /** Resolves a stable task ID so persistence code can address a result. */
  // Called by: the Vitest cases in this file through its owning hook, JSX prop, or analysis lifecycle config because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
  resolveTokenFrequencyTaskId: () => Promise.resolve('task-1'),
  backendTokenLimit: null,
  backendStopWordsKey: '',
  maxTokenLimitInput: 100,
};

describe('useTokenFrequencyPreferences', () => {
  beforeEach(() => {
    updateTokenFrequenciesTaskResultMock.mockReset();
  });

  it('fills default stop words for the chosen language', async () => {
    const { result } = renderHook(() => useTokenFrequencyPreferences({ ...baseArgs }));

    await act(async () => {
      await result.current.handleFillDefaultStopWords('zh');
    });

    await waitFor(() => expect(result.current.stopWords).toContain('的'));
  });

  it('does not fill default stop words when no language is chosen', async () => {
    const { result } = renderHook(() => useTokenFrequencyPreferences({ ...baseArgs }));

    await act(async () => {
      await result.current.handleFillDefaultStopWords('');
    });

    expect(result.current.stopWords).toBe('');
  });

  it('fills English default stop words for the chosen language', async () => {
    const { result } = renderHook(() => useTokenFrequencyPreferences({ ...baseArgs }));

    await act(async () => {
      await result.current.handleFillDefaultStopWords('en');
    });

    await waitFor(() => expect(result.current.stopWords).toContain('about'));
  });
});
