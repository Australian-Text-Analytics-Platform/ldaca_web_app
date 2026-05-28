import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { isStaleAnalysisResult, useSafeResult } from './useSafeResult';

interface ResultState {
  state?: string;
  value?: string;
}

describe('isStaleAnalysisResult', () => {
  it('should reject polling regressions from terminal states', () => {
    expect(
      isStaleAnalysisResult(
        { state: 'successful', value: 'final' },
        { state: 'running', value: 'old poll' },
      ),
    ).toBe(true);
  });

  it('should allow clearing the current result', () => {
    expect(isStaleAnalysisResult({ state: 'successful' }, null)).toBe(false);
  });
});

describe('useSafeResult', () => {
  it('should keep a terminal result when stale running data arrives later', () => {
    const { result } = renderHook(() => useSafeResult<ResultState>());

    act(() => {
      result.current[2]({ state: 'running', value: 'polling' });
    });
    act(() => {
      result.current[2]({ state: 'successful', value: 'final' });
    });
    act(() => {
      result.current[2]({ state: 'running', value: 'stale' });
    });

    expect(result.current[0]).toEqual({ state: 'successful', value: 'final' });
    expect(result.current[1].current).toEqual({ state: 'successful', value: 'final' });
  });

  it('should reset safely with null before a new run', () => {
    const { result } = renderHook(() => useSafeResult<ResultState>());

    act(() => {
      result.current[2]({ state: 'successful', value: 'final' });
    });
    act(() => {
      result.current[2](null);
    });
    act(() => {
      result.current[2]({ state: 'running', value: 'new run' });
    });

    expect(result.current[0]).toEqual({ state: 'running', value: 'new run' });
  });
});
