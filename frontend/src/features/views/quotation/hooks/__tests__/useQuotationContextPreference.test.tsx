import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_CONTEXT_LENGTH, MAX_CONTEXT_LENGTH } from '../../quotationTextClip';
import { useQuotationContextPreference } from '../useQuotationContextPreference';

const persistPreference = vi.fn(() => Promise.resolve());

describe('useQuotationContextPreference', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hydrates saved preferences into the displayed input and value', () => {
    const { result } = renderHook(() =>
      useQuotationContextPreference({
        currentWorkspaceId: 'workspace-1',
        hasLoaded: true,
        persistPreference,
      }),
    );

    act(() => {
      result.current.applyPreferenceFromResult({ preferences: { context_length: 12 } });
    });

    expect(result.current.contextLength).toBe(12);
    expect(result.current.contextLengthInput).toBe('12');
    expect(result.current.contextLengthError).toBeNull();
  });

  it('validates and clamps edits before updating the active context length', async () => {
    const { result } = renderHook(() =>
      useQuotationContextPreference({
        currentWorkspaceId: null,
        hasLoaded: false,
        persistPreference,
      }),
    );

    act(() => {
      result.current.setContextLengthInput('');
    });
    await act(async () => {
      await result.current.applyContextLengthInput();
    });

    expect(result.current.contextLength).toBe(DEFAULT_CONTEXT_LENGTH);
    expect(result.current.contextLengthError).toBe('Enter a non-negative number.');

    act(() => {
      result.current.setContextLengthInput(String(MAX_CONTEXT_LENGTH + 10));
    });
    await act(async () => {
      await result.current.applyContextLengthInput();
    });

    expect(result.current.contextLength).toBe(MAX_CONTEXT_LENGTH);
    expect(result.current.contextLengthInput).toBe(String(MAX_CONTEXT_LENGTH));
    expect(result.current.contextLengthError).toBeNull();
    expect(persistPreference).not.toHaveBeenCalled();
  });

  it('persists changed context length only after results are loaded in a workspace', async () => {
    const { result, rerender } = renderHook(
      ({ hasLoaded }: { hasLoaded: boolean }) =>
        useQuotationContextPreference({
          currentWorkspaceId: 'workspace-1',
          hasLoaded,
          persistPreference,
        }),
      { initialProps: { hasLoaded: false } },
    );

    act(() => {
      result.current.setContextLengthInput('8');
    });
    await act(async () => {
      await result.current.applyContextLengthInput();
    });

    expect(persistPreference).not.toHaveBeenCalled();

    rerender({ hasLoaded: true });

    act(() => {
      result.current.setContextLengthInput('10');
    });
    await act(async () => {
      await result.current.applyContextLengthInput();
    });

    expect(persistPreference).toHaveBeenCalledWith(10);
    expect(result.current.isSavingContextLength).toBe(false);
  });
});
