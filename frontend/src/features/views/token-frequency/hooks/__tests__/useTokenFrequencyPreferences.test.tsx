import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useTokenFrequencyPreferences } from '../useTokenFrequencyPreferences';

/** Provides the default hook arguments shared across preference tests. */
const baseArgs = {
  results: null,
  backendTokenLimit: null,
  backendStopWordsKey: '',
  maxTokenLimitInput: 100,
};

describe('useTokenFrequencyPreferences', () => {
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

  it('prefers saved per-tab presentation values over the run defaults', async () => {
    const { result } = renderHook(() =>
      useTokenFrequencyPreferences({
        ...baseArgs,
        results: {} as never,
        backendTokenLimit: 25,
        backendStopWordsKey: 'from|request',
        savedTokenLimit: 40,
        savedStopWordsJson: JSON.stringify(['saved', 'words']),
      }),
    );

    await waitFor(() => {
      expect(result.current.effectiveTokenLimit).toBe(40);
      expect([...result.current.appliedStopSet]).toEqual(['saved', 'words']);
    });
  });

  it('reports committed result presentation changes to the tab store', async () => {
    const onTokenLimitChange = vi.fn();
    const onStopWordsChange = vi.fn();
    const { result } = renderHook(() =>
      useTokenFrequencyPreferences({
        ...baseArgs,
        results: {} as never,
        onTokenLimitChange,
        onStopWordsChange,
      }),
    );

    act(() => {
      result.current.applyTokenLimit(30);
      result.current.applyStopSetFromText('alpha, beta');
    });

    expect(onTokenLimitChange).toHaveBeenCalledWith(30);
    expect(onStopWordsChange).toHaveBeenCalledWith(['alpha', 'beta']);
  });
});
