import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useSequentialChartControls } from '../useSequentialChartControls';

describe('useSequentialChartControls', () => {
  it('toggles hidden series keys', () => {
    const { result } = renderHook(() => useSequentialChartControls());

    act(() => {
      result.current.toggleKey('speaker-a');
    });

    expect(result.current.hiddenKeys.has('speaker-a')).toBe(true);

    act(() => {
      result.current.toggleKey('speaker-a');
    });

    expect(result.current.hiddenKeys.has('speaker-a')).toBe(false);
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

  it('resets result selection independently from hidden keys', () => {
    const { result } = renderHook(() => useSequentialChartControls());

    act(() => {
      result.current.toggleKey('speaker-a');
      result.current.selectPeriod(0, false, 3);
      result.current.resetResultSelection();
    });

    expect(result.current.hiddenKeys.has('speaker-a')).toBe(true);
    expect(result.current.selectedPeriodIndices.size).toBe(0);
  });

  it('clears hidden keys and selection after result clearing', () => {
    const { result } = renderHook(() => useSequentialChartControls());

    act(() => {
      result.current.toggleKey('speaker-a');
      result.current.selectPeriod(0, false, 3);
      result.current.resetAfterClear();
    });

    expect(result.current.hiddenKeys.size).toBe(0);
    expect(result.current.selectedPeriodIndices.size).toBe(0);
  });
});
