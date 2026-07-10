import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTokenFrequencyPreferences } from '../useTokenFrequencyPreferences';

const { analysisTaskPreferencesMock } = vi.hoisted(() => ({
  analysisTaskPreferencesMock: vi.fn(),
}));

vi.mock('@/api/generated/sdk.gen', () => ({
  analysisTaskPreferences: analysisTaskPreferencesMock,
}));

/** Provides the default hook arguments shared across preference tests. */
const baseArgs = {
  currentWorkspaceId: 'ws-1',
  results: null,
  setResults: vi.fn(),
  /** Resolves a stable task ID so persistence code can address a result. */
  resolveTokenFrequencyTaskId: () => Promise.resolve('task-1'),
  backendTokenLimit: null,
  backendStopWordsKey: '',
  maxTokenLimitInput: 100,
};

describe('useTokenFrequencyPreferences', () => {
  beforeEach(() => {
    analysisTaskPreferencesMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('adds default stop words for the chosen language', async () => {
    const { result } = renderHook(() => useTokenFrequencyPreferences({ ...baseArgs }));

    await act(async () => {
      await result.current.handleAddDefaultStopWords('zh');
    });

    await waitFor(() => {
      expect(result.current.stopWords).toContain('的');
    });
  });

  it('rejects an empty language before starting a stopword load', async () => {
    const { result } = renderHook(() => useTokenFrequencyPreferences({ ...baseArgs }));

    await expect(result.current.handleAddDefaultStopWords('')).rejects.toThrow(
      'Default stop words require a language selection',
    );

    expect(result.current.stopWords).toBe('');
    expect(result.current.isLoadingStopWords).toBe(false);
  });

  it('appends a second language without dropping the first', async () => {
    const { result } = renderHook(() => useTokenFrequencyPreferences({ ...baseArgs }));

    await act(async () => {
      await result.current.handleAddDefaultStopWords('en');
    });
    await waitFor(() => {
      expect(result.current.stopWords).toContain('about');
    });

    await act(async () => {
      await result.current.handleAddDefaultStopWords('zh');
    });

    await waitFor(() => {
      expect(result.current.stopWords).toContain('的');
    });
    expect(result.current.stopWords).toContain('about');
  });

  it('clamps the backend token limit into the editable input', async () => {
    const { result } = renderHook(() =>
      useTokenFrequencyPreferences({ ...baseArgs, backendTokenLimit: 500 }),
    );

    await waitFor(() => {
      expect(result.current.tokenLimitInput).toBe('100');
      expect(result.current.effectiveTokenLimit).toBe(100);
    });
  });

  it('reports token-limit validation errors through the public blur handler', async () => {
    const { result } = renderHook(() => useTokenFrequencyPreferences({ ...baseArgs }));

    act(() => {
      result.current.handleTokenLimitInputChange({
        target: { value: 'not a number' },
      } as React.ChangeEvent<HTMLInputElement>);
      result.current.handleTokenLimitBlur();
    });

    await waitFor(() => {
      expect(result.current.tokenLimitError).toBe('Enter a whole number greater than zero.');
    });
  });
});
