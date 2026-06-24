import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DISPERSION_DEFAULT_BIN_COUNT } from '../../concordanceViewModels';
import { useConcordanceDispersionControls } from '../useConcordanceDispersionControls';

describe('useConcordanceDispersionControls', () => {
  it('initializes the dispersion display controls with table-oriented defaults', () => {
    const { result } = renderHook(() => useConcordanceDispersionControls());

    expect(result.current.concordanceView).toBe('table');
    expect(result.current.showDispersion).toBe(false);
    expect(result.current.proportionalDispersionBars).toBe(false);
    expect(result.current.colourMatches).toBe(false);
    expect(result.current.lowercaseMatches).toBe(false);
    expect(result.current.hiddenMatchedTexts.size).toBe(0);
    expect(result.current.binCount).toBe(DISPERSION_DEFAULT_BIN_COUNT);
    expect(result.current.combinedSourceMode).toBe('aggregate');
    expect(result.current.dispersionChartMode).toBe('density');
    expect(result.current.selectedBinIndices).toEqual({});
  });

  it('tracks bin selections per block and supports shift-range extension', () => {
    const { result } = renderHook(() => useConcordanceDispersionControls());

    act(() => {
      result.current.handleBinSelect('node-a', 2, false);
      result.current.handleBinSelect('node-a', 5, true);
      result.current.handleBinSelect('node-b', 1, false);
    });

    expect(Array.from(result.current.selectedBinIndices['node-a'] ?? [])).toEqual([2, 3, 4, 5]);
    expect(Array.from(result.current.selectedBinIndices['node-b'] ?? [])).toEqual([1]);

    act(() => {
      result.current.handleClearBinSelection('node-a');
    });

    expect(result.current.selectedBinIndices['node-a']).toBeUndefined();
    expect(Array.from(result.current.selectedBinIndices['node-b'] ?? [])).toEqual([1]);
  });

  it('clears non-portable bin selections when the bin count changes', () => {
    const { result } = renderHook(() => useConcordanceDispersionControls());

    act(() => {
      result.current.handleBinSelect('node-a', 7, false);
      result.current.setBinCount(100);
    });

    expect(result.current.binCount).toBe(100);
    expect(result.current.selectedBinIndices).toEqual({});

    act(() => {
      result.current.handleBinSelect('node-a', 10, true);
    });

    expect(Array.from(result.current.selectedBinIndices['node-a'] ?? [])).toEqual([10]);
  });

  it('replaces the active selection with a dragged bin range and supports shift extension', () => {
    const { result } = renderHook(() => useConcordanceDispersionControls());

    act(() => {
      result.current.handleBinRangeSelect('node-a', 4, 2, false);
    });

    expect(Array.from(result.current.selectedBinIndices['node-a'] ?? [])).toEqual([2, 3, 4]);

    act(() => {
      result.current.handleBinRangeSelect('node-a', 7, 8, true);
    });

    expect(Array.from(result.current.selectedBinIndices['node-a'] ?? [])).toEqual([
      2, 3, 4, 7, 8,
    ]);
  });
});
