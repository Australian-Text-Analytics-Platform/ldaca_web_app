import { useRef, useState } from 'react';

import type { SequentialXAxisType } from './sequentialChartModel';

/**
 * Owns chart interaction state for sequential analysis: hidden series, selected
 * periods, x-axis mode, and the export dialog.
 * Used by: SequentialAnalysisFeature so task lifecycle and request parameters
 * stay separate from chart-only interaction state.
 * Flow: toggle legend keys, support single/range period selection, clear
 * result-bound controls when results refresh, and fully reset chart controls
 * when results are cleared.
 */
export function useSequentialChartControls() {
  const [xAxisType, setXAxisType] = useState<SequentialXAxisType>('category');
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(new Set());
  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false);
  const [selectedPeriodIndices, setSelectedPeriodIndices] = useState<Set<number>>(new Set());
  const lastClickedIndexRef = useRef<number | null>(null);

  /**
   * Toggles chart series visibility without losing the underlying result rows.
   * Called by: SequentialAnalysisResultsPanel legend controls.
   */
  const toggleKey = (key: string) => {
    setHiddenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  /**
   * Toggles or range-selects chart periods for chart inspection.
   * Called by: SequentialChart point clicks with the current chart length from
   * SequentialAnalysisFeature.
   */
  const selectPeriod = (index: number, shiftHeld: boolean, chartDataLength: number) => {
    if (index < 0 || index >= chartDataLength) return;

    setSelectedPeriodIndices((prev) => {
      const next = new Set(prev);

      if (shiftHeld && lastClickedIndexRef.current !== null) {
        const lower = Math.min(lastClickedIndexRef.current, index);
        const upper = Math.max(lastClickedIndexRef.current, index);
        for (let cursor = lower; cursor <= upper; cursor += 1) {
          next.add(cursor);
        }
      } else {
        if (next.has(index)) {
          next.delete(index);
        } else {
          next.add(index);
        }
        lastClickedIndexRef.current = index;
      }

      return next;
    });
  };

  /**
   * Clears selected chart periods and the anchor used for shift-click range
   * selection.
   * Called by: SequentialAnalysisResultsPanel and result refresh handlers.
   */
  const clearPeriodSelection = () => {
    setSelectedPeriodIndices(new Set());
    lastClickedIndexRef.current = null;
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
    setHiddenKeys(new Set());
    resetResultSelection();
  };

  return {
    xAxisType,
    setXAxisType,
    hiddenKeys,
    downloadDialogOpen,
    setDownloadDialogOpen,
    selectedPeriodIndices,
    toggleKey,
    selectPeriod,
    clearPeriodSelection,
    resetResultSelection,
    resetAfterClear,
  };
}
