import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useSequentialChartControls } from '../useSequentialChartControls';

describe('useSequentialChartControls', () => {
  it('toggles exact group indices', () => {
    const { result } = renderHook(() => useSequentialChartControls());

    act(() => {
      result.current.toggleGroupIndices([2, 3]);
    });

    expect(result.current.excludedGroupIndices).toEqual(new Set([2, 3]));

    act(() => {
      result.current.toggleGroupIndices([2, 3]);
    });

    expect(result.current.excludedGroupIndices.size).toBe(0);
  });

  it('selects individual periods and shift-click ranges', () => {
    const { result } = renderHook(() => useSequentialChartControls());

    act(() => {
      result.current.selectPeriod(1, false, 5);
      result.current.selectPeriod(4, true, 5);
    });

    expect(Array.from(result.current.selectedPeriodIndices).sort()).toEqual([1, 2, 3, 4]);

    act(() => {
      result.current.selectPeriod(4, false, 5);
    });

    expect(Array.from(result.current.selectedPeriodIndices).sort()).toEqual([1, 2, 3]);
  });

  it('ignores period selections outside the chart data bounds', () => {
    const { result } = renderHook(() => useSequentialChartControls());

    act(() => {
      result.current.selectPeriod(-1, false, 2);
      result.current.selectPeriod(2, false, 2);
    });

    expect(result.current.selectedPeriodIndices.size).toBe(0);
  });

  it('replaces or extends selection with a brushed period range', () => {
    const { result } = renderHook(() => useSequentialChartControls());

    act(() => {
      result.current.selectPeriod(0, false, 6);
      result.current.selectPeriodRange(2, 4, false, 6);
    });
    expect(Array.from(result.current.selectedPeriodIndices).sort()).toEqual([2, 3, 4]);

    act(() => {
      result.current.selectPeriodRange(0, 1, true, 6);
    });
    expect(Array.from(result.current.selectedPeriodIndices).sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it('resets result selection independently from excluded groups', () => {
    const { result } = renderHook(() => useSequentialChartControls());

    act(() => {
      result.current.toggleGroupIndices([2]);
      result.current.selectPeriod(0, false, 3);
      result.current.resetResultSelection();
    });

    expect(result.current.excludedGroupIndices.has(2)).toBe(true);
    expect(result.current.selectedPeriodIndices.size).toBe(0);
  });

  it('clears excluded groups and selection after result clearing', () => {
    const { result } = renderHook(() => useSequentialChartControls());

    act(() => {
      result.current.toggleGroupIndices([2]);
      result.current.selectPeriod(0, false, 3);
      result.current.resetAfterClear();
    });

    expect(result.current.excludedGroupIndices.size).toBe(0);
    expect(result.current.selectedPeriodIndices.size).toBe(0);
  });

  it('restores groups when Uncased changes without clearing period selection', () => {
    const { result } = renderHook(() => useSequentialChartControls());

    act(() => {
      result.current.toggleGroupIndices([1]);
      result.current.selectPeriod(2, false, 4);
      result.current.setUncasedGroups(true);
    });

    expect(result.current.uncasedGroups).toBe(true);
    expect(result.current.excludedGroupIndices.size).toBe(0);
    expect(result.current.selectedPeriodIndices).toEqual(new Set([2]));
  });

  it('resets result-bound filters for a new result while preserving the axis mode', () => {
    const { result, rerender } = renderHook(
      ({ resultKey }) => useSequentialChartControls(resultKey),
      { initialProps: { resultKey: 'analysis-1' } },
    );

    act(() => {
      result.current.setXAxisType('number');
      result.current.setUncasedGroups(true);
      result.current.toggleGroupIndices([1]);
      result.current.selectPeriod(0, false, 2);
    });
    rerender({ resultKey: 'analysis-2' });

    expect(result.current.uncasedGroups).toBe(false);
    expect(result.current.excludedGroupIndices.size).toBe(0);
    expect(result.current.selectedPeriodIndices.size).toBe(0);
    expect(result.current.xAxisType).toBe('number');
  });
});
