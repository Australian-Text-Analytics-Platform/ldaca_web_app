import { useRef, useState } from 'react';

import {
  createCaseFoldedSeriesVisibility,
  reduceCaseFoldedSeriesVisibility,
} from '../../common/caseFoldedSeriesVisibility';
import { DEFAULT_MINIMUM_GROUP_COUNT, type SequentialXAxisType } from './sequentialChartModel';

/**
 * Owns chart interaction state for sequential analysis: hidden series, the
 * minimum group count, selected periods, x-axis mode, and the export dialog.
 * Used by: SequentialAnalysisFeature so task lifecycle and request parameters
 * stay separate from chart-only interaction state.
 * Flow: filter and toggle legend keys, support single/range period selection, clear
 * result-bound controls when results refresh, and fully reset chart controls
 * when results are cleared.
 */
export function useSequentialChartControls(resultKey?: string | null) {
  const [xAxisType, setXAxisType] = useState<SequentialXAxisType>('category');
  const [seriesVisibilityState, setSeriesVisibilityState] = useState<{
    resultKey: string | null | undefined;
    value: ReturnType<typeof createCaseFoldedSeriesVisibility<number>>;
    minimumGroupCount: number;
  }>({
    resultKey,
    value: createCaseFoldedSeriesVisibility<number>(),
    minimumGroupCount: DEFAULT_MINIMUM_GROUP_COUNT,
  });
  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false);
  const [selectionState, setSelectionState] = useState<{
    resultKey: string | null | undefined;
    values: Set<number>;
  }>({ resultKey, values: new Set() });
  const lastClickedIndexRef = useRef<{
    resultKey: string | null | undefined;
    value: number | null;
  }>({ resultKey, value: null });
  const seriesVisibility =
    seriesVisibilityState.resultKey === resultKey
      ? seriesVisibilityState.value
      : createCaseFoldedSeriesVisibility<number>();
  const minimumGroupCount =
    seriesVisibilityState.resultKey === resultKey
      ? seriesVisibilityState.minimumGroupCount
      : DEFAULT_MINIMUM_GROUP_COUNT;
  const selectedPeriodIndices =
    selectionState.resultKey === resultKey ? selectionState.values : new Set<number>();
  const lastClickedIndex = () =>
    lastClickedIndexRef.current.resultKey === resultKey ? lastClickedIndexRef.current.value : null;
  const setLastClickedIndex = (value: number | null) => {
    lastClickedIndexRef.current = { resultKey, value };
  };

  /**
   * Toggles chart series visibility without losing the underlying result rows.
   * Called by: SequentialAnalysisResultsPanel legend controls.
   */
  const toggleGroupIndices = (groupIndices: readonly number[]) => {
    setSeriesVisibilityState((previous) => {
      const current =
        previous.resultKey === resultKey
          ? previous.value
          : createCaseFoldedSeriesVisibility<number>();
      return {
        resultKey,
        value: reduceCaseFoldedSeriesVisibility(current, {
          type: 'toggle-members',
          keys: groupIndices,
        }),
        minimumGroupCount:
          previous.resultKey === resultKey
            ? previous.minimumGroupCount
            : DEFAULT_MINIMUM_GROUP_COUNT,
      };
    });
  };

  /** Updates the result-bound count filter without changing manual legend visibility. */
  const setMinimumGroupCount = (value: number) => {
    const normalized = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
    setSeriesVisibilityState((previous) => ({
      resultKey,
      value:
        previous.resultKey === resultKey
          ? previous.value
          : createCaseFoldedSeriesVisibility<number>(),
      minimumGroupCount: normalized,
    }));
  };

  /** Changes case folding and restores all exact groups, matching Concordance. */
  const setUncasedGroups = (value: boolean) => {
    setSeriesVisibilityState((previous) => {
      const current =
        previous.resultKey === resultKey
          ? previous.value
          : createCaseFoldedSeriesVisibility<number>();
      return {
        resultKey,
        value: reduceCaseFoldedSeriesVisibility(current, { type: 'set-uncased', value }),
        minimumGroupCount:
          previous.resultKey === resultKey
            ? previous.minimumGroupCount
            : DEFAULT_MINIMUM_GROUP_COUNT,
      };
    });
  };

  /**
   * Toggles or range-selects chart periods for chart inspection.
   * Called by: SequentialChart point clicks with the current chart length from
   * SequentialAnalysisFeature.
   */
  const selectPeriod = (index: number, shiftHeld: boolean, chartDataLength: number) => {
    if (index < 0 || index >= chartDataLength) return;

    setSelectionState((previous) => {
      const current = previous.resultKey === resultKey ? previous.values : new Set<number>();
      const next = new Set(current);
      const anchor = lastClickedIndex();

      if (shiftHeld && anchor !== null) {
        const lower = Math.min(anchor, index);
        const upper = Math.max(anchor, index);
        for (let cursor = lower; cursor <= upper; cursor += 1) {
          next.add(cursor);
        }
      } else {
        if (next.has(index)) {
          next.delete(index);
        } else {
          next.add(index);
        }
        setLastClickedIndex(index);
      }

      return { resultKey, values: next };
    });
  };

  /** Replaces or extends the selected periods with a brushed inclusive range. */
  const selectPeriodRange = (
    startIndex: number,
    endIndex: number,
    shiftHeld: boolean,
    chartDataLength: number,
  ) => {
    if (chartDataLength <= 0) return;
    const lower = Math.max(0, Math.min(startIndex, endIndex));
    const upper = Math.min(chartDataLength - 1, Math.max(startIndex, endIndex));
    if (lower > upper) return;
    setSelectionState((previous) => {
      const current = previous.resultKey === resultKey ? previous.values : new Set<number>();
      const next = shiftHeld ? new Set(current) : new Set<number>();
      for (let index = lower; index <= upper; index += 1) next.add(index);
      return { resultKey, values: next };
    });
    setLastClickedIndex(endIndex);
  };

  /**
   * Clears selected chart periods and the anchor used for shift-click range
   * selection.
   * Called by: SequentialAnalysisResultsPanel and result refresh handlers.
   */
  const clearPeriodSelection = () => {
    setSelectionState({ resultKey, values: new Set() });
    setLastClickedIndex(null);
  };

  /**
   * Clears result-bound period selection without touching chart visibility.
   * Called by: SequentialAnalysisFeature when a result payload is fetched or
   * hydrated.
   */
  const resetResultSelection = () => {
    clearPeriodSelection();
  };

  /**
   * Resets all chart controls that should return to defaults after Clear
   * Results.
   * Called by: SequentialAnalysisFeature after the shared analysis lifecycle
   * clears the active task result.
   */
  const resetAfterClear = () => {
    setSeriesVisibilityState({
      resultKey,
      value: createCaseFoldedSeriesVisibility<number>(),
      minimumGroupCount: DEFAULT_MINIMUM_GROUP_COUNT,
    });
    resetResultSelection();
  };

  return {
    xAxisType,
    setXAxisType,
    uncasedGroups: seriesVisibility.uncased,
    excludedGroupIndices: seriesVisibility.excludedKeys,
    minimumGroupCount,
    setMinimumGroupCount,
    downloadDialogOpen,
    setDownloadDialogOpen,
    selectedPeriodIndices,
    toggleGroupIndices,
    setUncasedGroups,
    selectPeriod,
    selectPeriodRange,
    clearPeriodSelection,
    resetResultSelection,
    resetAfterClear,
  };
}
