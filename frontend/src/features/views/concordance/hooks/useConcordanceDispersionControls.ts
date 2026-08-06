import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  type ConcordanceDispersionChartMode,
  DISPERSION_DEFAULT_BIN_COUNT,
  type DispersionDisplayBinCount,
} from '../concordanceDispersionDomain';

export interface UseConcordanceDispersionControlsResult {
  concordanceView: 'table' | 'dispersion';
  setConcordanceView: Dispatch<SetStateAction<'table' | 'dispersion'>>;
  showDispersion: boolean;
  proportionalDispersionBars: boolean;
  setProportionalDispersionBars: Dispatch<SetStateAction<boolean>>;
  binCount: DispersionDisplayBinCount;
  setBinCount: (value: DispersionDisplayBinCount) => void;
  dispersionChartMode: ConcordanceDispersionChartMode;
  setDispersionChartMode: Dispatch<SetStateAction<ConcordanceDispersionChartMode>>;
  selectedBinIndices: Record<string, Set<number>>;
  excludedMatchedTexts: Record<string, Set<string>>;
  toggleMatchedText: (blockKey: string, matchedText: string) => void;
  handleBinSelect: (blockKey: string, index: number, shiftHeld: boolean) => void;
  handleBinRangeSelect: (
    blockKey: string,
    startIndex: number,
    endIndex: number,
    shiftHeld: boolean,
  ) => void;
  handleClearBinSelection: (blockKey: string) => void;
  resetDispersionFilters: () => void;
}

/**
 * Owns concordance dispersion display preferences and bin selection.
 *
 * Used by: ConcordanceFeature because the top-level feature needs to pass
 * chart/table preferences into ConcordanceResultsPanel without also owning the
 * click-range bookkeeping for dispersion bins.
 *
 * Flow: initialize table-first defaults, update per-block bin selections from
 * click and shift-click gestures, clear a block selection on request, and reset
 * all selections when bin density changes because old indices describe
 * different document ranges.
 */
export function useConcordanceDispersionControls(): UseConcordanceDispersionControlsResult {
  const [concordanceView, setConcordanceView] = useState<'table' | 'dispersion'>('table');
  const [proportionalDispersionBars, setProportionalDispersionBars] = useState(false);
  const [binCount, setRawBinCount] = useState<DispersionDisplayBinCount>(
    DISPERSION_DEFAULT_BIN_COUNT,
  );
  const [dispersionChartMode, setDispersionChartMode] =
    useState<ConcordanceDispersionChartMode>('density-line');
  const [selectedBinIndices, setSelectedBinIndices] = useState<Record<string, Set<number>>>({});
  const [excludedMatchedTexts, setExcludedMatchedTexts] = useState<Record<string, Set<string>>>({});
  const lastSelectedBinRef = useRef<Record<string, number | null>>({});

  /** Updates a block's bin set from a click or shift-click range gesture. */
  // Called by: ConcordanceDispersionNodeBlock through ConcordanceResultsPanel because chart cells delegate bin-selection gestures back to the feature-level control state.
  const handleBinSelect = (blockKey: string, index: number, shiftHeld: boolean) => {
    const lastIdx = lastSelectedBinRef.current[blockKey];
    setSelectedBinIndices((prev) => {
      const prevSet = prev[blockKey] ?? new Set<number>();
      const next = new Set(prevSet);
      if (shiftHeld && typeof lastIdx === 'number') {
        const [from, to] = lastIdx < index ? [lastIdx, index] : [index, lastIdx];
        for (let i = from; i <= to; i++) next.add(i);
      } else if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return { ...prev, [blockKey]: next };
    });
    lastSelectedBinRef.current[blockKey] = index;
  };

  /** Replaces or extends a block's bin set from a chart drag-selection range. */
  // Called by: ConcordanceDispersionSummary drag gestures because chart drag-selection should select every bin between the pointer-down and pointer-up locations in one state update.
  const handleBinRangeSelect = (
    blockKey: string,
    startIndex: number,
    endIndex: number,
    shiftHeld: boolean,
  ) => {
    const [from, to] = startIndex < endIndex ? [startIndex, endIndex] : [endIndex, startIndex];
    setSelectedBinIndices((prev) => {
      const next = shiftHeld ? new Set(prev[blockKey] ?? []) : new Set<number>();
      for (let index = from; index <= to; index++) next.add(index);
      return { ...prev, [blockKey]: next };
    });
    lastSelectedBinRef.current[blockKey] = endIndex;
  };

  /** Clears one block's selected bins while preserving other block selections. */
  // Called by: ConcordanceDispersionNodeBlock through ConcordanceResultsPanel because each rendered block exposes its own clear-selection action.
  const handleClearBinSelection = (blockKey: string) => {
    setSelectedBinIndices((prev) => {
      if (!prev[blockKey]) return prev;
      const next: Record<string, Set<number>> = {};
      for (const [key, value] of Object.entries(prev)) {
        if (key !== blockKey) next[key] = value;
      }
      return next;
    });
    lastSelectedBinRef.current[blockKey] = null;
  };

  /** Changes bin density and clears stale selections whose indices no longer map to the same ranges. */
  // Called by: ConcordanceDispersionNodeBlock's bin-count selector because changing density makes existing selection indices non-portable.
  const setBinCount = (value: DispersionDisplayBinCount) => {
    setRawBinCount(value);
    setSelectedBinIndices((prev) => (Object.keys(prev).length === 0 ? prev : {}));
    lastSelectedBinRef.current = {};
  };

  const toggleMatchedText = (blockKey: string, matchedText: string) => {
    setExcludedMatchedTexts((current) => {
      const nextForBlock = new Set(current[blockKey] ?? []);
      if (nextForBlock.has(matchedText)) nextForBlock.delete(matchedText);
      else nextForBlock.add(matchedText);
      return { ...current, [blockKey]: nextForBlock };
    });
  };

  // Stable identity is required because ConcordanceFeature resets filters from
  // an effect keyed only by the immutable Run All identity.
  const resetDispersionFilters = useCallback(() => {
    setSelectedBinIndices({});
    setExcludedMatchedTexts({});
    lastSelectedBinRef.current = {};
  }, []);

  return {
    concordanceView,
    setConcordanceView,
    showDispersion: concordanceView === 'dispersion',
    proportionalDispersionBars,
    setProportionalDispersionBars,
    binCount,
    setBinCount,
    dispersionChartMode,
    setDispersionChartMode,
    selectedBinIndices,
    excludedMatchedTexts,
    toggleMatchedText,
    handleBinSelect,
    handleBinRangeSelect,
    handleClearBinSelection,
    resetDispersionFilters,
  };
}
