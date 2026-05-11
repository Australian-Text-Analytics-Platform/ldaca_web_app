import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';
import type { ConcordanceAnalysisResponse, ConcordanceResultQuery } from '@/api/text';

type Params = {
  viewMode: 'separated' | 'combined';
  setViewMode: Dispatch<SetStateAction<'separated' | 'combined'>>;
  results: ConcordanceAnalysisResponse | null;
  combinedPage: number;
  globalPageSize: number;
  updateStoredResult: (
    query: Partial<ConcordanceResultQuery>,
  ) => Promise<unknown>;
  resultsRef: RefObject<HTMLDivElement | null>;
};

export type UseConcordanceViewModeSwapResult = {
  /** Loading flag toggled while a Combined-view fetch is in flight. */
  combinedLoading: boolean;
  /**
   * Switch concordance result view mode. When swapping into / out of the
   * Combined layout, preserves the user's scroll position by anchoring to
   * the results card before/after the table re-renders.
   */
  handleViewModeChange: (nextMode: 'separated' | 'combined') => void;
};

/**
 * Owns the user-visible "separated ↔ combined" view-mode swap, plus the two
 * effects that keep it consistent:
 *
 *   1. Auto-revert: if results report `combinable === false` while the user
 *      is in Combined view (e.g. after a re-run that produced a single
 *      block), drop back to Separated.
 *   2. Refetch on combined-page change: when the page changes while in
 *      Combined view, re-issue the result query.
 *
 * The scroll-preservation logic anchors to `resultsRef` (the results card),
 * grabs `getBoundingClientRect().top` before the swap, and restores it after
 * a double-rAF so the new layout has had a chance to settle.
 */
export function useConcordanceViewModeSwap({
  viewMode,
  setViewMode,
  results,
  combinedPage,
  globalPageSize,
  updateStoredResult,
  resultsRef,
}: Params): UseConcordanceViewModeSwapResult {
  const [combinedLoading, setCombinedLoading] = useState(false);
  const lastCombinedQueryRef = useRef<string | null>(null);

  useEffect(() => {
    if (viewMode === 'combined' && results && results.combinable === false) {
      // Defer to avoid synchronous setState in effect body (react-hooks/set-state-in-effect)
      const id = requestAnimationFrame(() => setViewMode('separated'));
      return () => cancelAnimationFrame(id);
    }
  }, [viewMode, results, setViewMode]);

  useEffect(() => {
    if (viewMode !== 'combined' || !results) {
      return;
    }
    const taskId =
      results?.metadata?.task_id
      ?? (results?.metadata as Record<string, unknown> | undefined)?.taskId
      ?? '';
    const key = `${taskId}|${combinedPage}|${globalPageSize}`;
    if (lastCombinedQueryRef.current === key) {
      return;
    }
    lastCombinedQueryRef.current = key;
    void updateStoredResult({ combined: true, page: combinedPage, page_size: globalPageSize });
  }, [viewMode, results, combinedPage, globalPageSize, updateStoredResult]);

  const handleViewModeChange = useCallback(
    (nextMode: 'separated' | 'combined') => {
      if (nextMode === viewMode) {
        return;
      }

      setViewMode(nextMode);

      if (nextMode === 'combined' && results?.combinable) {
        const prevAnchor = resultsRef.current;
        if (prevAnchor) {
          const rect = prevAnchor.getBoundingClientRect();
          prevAnchor.style.minHeight = `${rect.height}px`;
        }

        setTimeout(() => {
          const prevTop =
            prevAnchor?.getBoundingClientRect().top
            ?? resultsRef.current?.getBoundingClientRect().top
            ?? 0;
          const prevScrollY = window.scrollY;

          setCombinedLoading(true);
          updateStoredResult({ combined: true, page: combinedPage, page_size: globalPageSize })
            .finally(() => {
              setCombinedLoading(false);
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

        updateStoredResult({ combined: false, page: 1, page_size: globalPageSize }).finally(() => {
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
      combinedPage,
      globalPageSize,
    ],
  );

  return { combinedLoading, handleViewModeChange };
}
