import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';
import type { ConcordanceAnalysisResponse, ConcordanceResultQuery } from '@/api';
import { buildCombinedSlice, CONCORDANCE_COMBINED_NODE_KEY } from '../concordanceViewModels';

interface Params {
  viewMode: 'separated' | 'combined';
  setViewMode: Dispatch<SetStateAction<'separated' | 'combined'>>;
  results: ConcordanceAnalysisResponse | null;
  setResults: Dispatch<SetStateAction<ConcordanceAnalysisResponse | null>>;
  combinedPage: number;
  globalPageSize: number;
  updateStoredResult: (
    query: Partial<ConcordanceResultQuery>,
    options?: { mergeNodeData?: boolean },
  ) => Promise<ConcordanceAnalysisResponse | null>;
  resultsRef: RefObject<HTMLDivElement | null>;
}

export interface UseConcordanceViewModeSwapResult {
  /** Loading flag toggled while a Combined-view fetch is in flight. */
  combinedLoading: boolean;
  /**
   * Switch concordance result view mode. When swapping into / out of the
   * Combined layout, preserves the user's scroll position by anchoring to
   * the results card before/after the table re-renders.
   */
  handleViewModeChange: (nextMode: 'separated' | 'combined') => void;
}

/**
 * Owns the user-visible "separated ↔ combined" view-mode swap, plus the two
 * effects that keep it consistent:
 *
 *   1. Auto-revert: if results report `combinable === false` while the user
 *      is in Combined view (e.g. after a re-run that produced a single
 *      block), drop back to Separated.
 *   2. Refetch on combined-page change: when the page changes while in
 *      Combined view, re-fetch both nodes and rebuild the combined block.
 *
 * The Combined view is synthesized entirely on the client: there is no backend
 * "combined" mode anymore. Entering Combined (or paging within it) fetches
 * BOTH nodes at the same page via scoped per-node result queries, then folds
 * them into a single combined block via `buildCombinedSlice`. Next/prev in
 * Combined view is therefore equivalent to next/prev on both nodes at once.
 *
 * The scroll-preservation logic anchors to `resultsRef` (the results card),
 * grabs `getBoundingClientRect().top` before the swap, and restores it after
 * a double-rAF so the new layout has had a chance to settle.
 */
/**
 * Used by: ConcordanceFeature.tsx because callers need shared hook state and handlers without duplicating analysis lifecycle wiring.
 * Flow: read caller config, derive local analysis state, call store/API helpers as needed, then return state and handlers to the feature.
 */
export function useConcordanceViewModeSwap({
  viewMode,
  setViewMode,
  results,
  setResults,
  combinedPage,
  globalPageSize,
  updateStoredResult,
  resultsRef,
}: Params): UseConcordanceViewModeSwapResult {
  const [combinedLoading, setCombinedLoading] = useState(false);
  const lastCombinedQueryRef = useRef<string | null>(null);

  /**
   * Fetches both source nodes at `page` and rebuilds the combined block.
   *
   * Called by: the combined-page effect and `handleViewModeChange` because
   * entering Combined view or paging within it must re-page both nodes and
   * re-synthesize the interleaved view client-side.
   *
   * Flow: derive the two node ids from the current result data (insertion order
   * = backend node order = left/right), issue two scoped per-node queries with
   * `mergeNodeData` so each node slice refreshes independently (preserving Bug
   * #2's per-table isolation), then interleave the returned slices into a fresh
   * combined entry.
   */
  const refetchCombined = useCallback(
    async (page: number) => {
      const nodeKeys = results?.data
        ? Object.keys(results.data).filter((key) => key !== CONCORDANCE_COMBINED_NODE_KEY)
        : [];
      if (nodeKeys.length < 2) {
        return;
      }
      const [leftId, rightId] = nodeKeys;
      if (leftId === undefined || rightId === undefined) {
        return;
      }

      setCombinedLoading(true);
      try {
        const [leftResp, rightResp] = await Promise.all([
          updateStoredResult(
            { node_id: leftId, page, page_size: globalPageSize },
            { mergeNodeData: true },
          ),
          updateStoredResult(
            { node_id: rightId, page, page_size: globalPageSize },
            { mergeNodeData: true },
          ),
        ]);

        const leftSlice = leftResp?.data[leftId];
        const rightSlice = rightResp?.data[rightId];
        if (!leftSlice || !rightSlice) {
          return;
        }

        const combined = buildCombinedSlice(leftSlice, rightSlice, page, globalPageSize);
        setResults((prev) =>
          prev?.data
            ? { ...prev, data: { ...prev.data, [CONCORDANCE_COMBINED_NODE_KEY]: combined } }
            : prev,
        );
      } finally {
        setCombinedLoading(false);
      }
    },
    [results, globalPageSize, updateStoredResult, setResults],
  );

  useEffect(() => {
    if (viewMode === 'combined' && results?.combinable === false) {
      // Defer to avoid synchronous setState in effect body (react-hooks/set-state-in-effect)
      const id = requestAnimationFrame(() => {
        setViewMode('separated');
      });
      return () => {
        cancelAnimationFrame(id);
      };
    }
  }, [viewMode, results, setViewMode]);

  useEffect(() => {
    if (viewMode !== 'combined' || !results) {
      return;
    }
    const metadataRecord = results.metadata as Record<string, unknown> | undefined;
    const rawTaskId = results.metadata?.task_id ?? metadataRecord?.taskId;
    const taskId = typeof rawTaskId === 'string' ? rawTaskId : '';
    const key = `${taskId}|${String(combinedPage)}|${String(globalPageSize)}`;
    if (lastCombinedQueryRef.current === key) {
      return;
    }
    lastCombinedQueryRef.current = key;
    void refetchCombined(combinedPage);
  }, [viewMode, results, combinedPage, globalPageSize, refetchCombined]);

  const handleViewModeChange = useCallback(
    (nextMode: 'separated' | 'combined') => {
      if (nextMode === viewMode) {
        return;
      }

      setViewMode(nextMode);

      if (nextMode === 'combined' && results?.combinable) {
        // Pre-stamp the dedupe key so the combined-page effect doesn't also
        // fire a redundant fetch for the same (task, page, pageSize) tuple.
        const metadataRecord = results.metadata as Record<string, unknown> | undefined;
        const rawTaskId = results.metadata?.task_id ?? metadataRecord?.taskId;
        const taskId = typeof rawTaskId === 'string' ? rawTaskId : '';
        lastCombinedQueryRef.current = `${taskId}|${String(combinedPage)}|${String(globalPageSize)}`;

        const prevAnchor = resultsRef.current;
        if (prevAnchor) {
          const rect = prevAnchor.getBoundingClientRect();
          prevAnchor.style.minHeight = `${String(rect.height)}px`;
        }

        setTimeout(() => {
          const prevTop =
            prevAnchor?.getBoundingClientRect().top ??
            resultsRef.current?.getBoundingClientRect().top ??
            0;
          const prevScrollY = window.scrollY;

          void refetchCombined(combinedPage).finally(() => {
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                const newAnchor = resultsRef.current;
                if (newAnchor) {
                  const newTop = newAnchor.getBoundingClientRect().top;
                  const delta = newTop - prevTop;
                  if (Math.abs(delta) > 1) {
                    window.scrollTo({ top: prevScrollY + delta });
                  }
                  newAnchor.style.minHeight = '';
                } else {
                  window.scrollTo({ top: prevScrollY });
                }
              });
            });
          });
        }, 30);

        return;
      }

      if (nextMode === 'separated') {
        const prevAnchor = resultsRef.current;
        const prevTop = prevAnchor?.getBoundingClientRect().top ?? 0;
        const prevScrollY = window.scrollY;

        // Full-replace refetch: re-pages every node to page 1 (no scoped
        // node_id), restoring the independent per-node separated layout.
        void updateStoredResult({ page: 1, page_size: globalPageSize }).finally(() => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              const newAnchor = resultsRef.current;
              if (newAnchor) {
                const newTop = newAnchor.getBoundingClientRect().top;
                const delta = newTop - prevTop;
                if (Math.abs(delta) > 1) {
                  window.scrollTo({ top: prevScrollY + delta });
                }
                newAnchor.style.minHeight = '';
              } else {
                window.scrollTo({ top: prevScrollY });
              }
            });
          });
        });
      }
    },
    [
      viewMode,
      setViewMode,
      results,
      resultsRef,
      updateStoredResult,
      refetchCombined,
      combinedPage,
      globalPageSize,
    ],
  );

  return { combinedLoading, handleViewModeChange };
}
