import { useCallback, useEffect, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { ConcordanceAnalysisResponse } from '@/api';

interface Params {
  viewMode: 'separated' | 'combined';
  setViewMode: Dispatch<SetStateAction<'separated' | 'combined'>>;
  results: ConcordanceAnalysisResponse | null;
  combinedLoading: boolean;
  resultsRef: RefObject<HTMLDivElement | null>;
}

/** Owns only Concordance presentation mode and scroll anchoring; Query owns every page. */
export function useConcordanceViewModeSwap({
  viewMode,
  setViewMode,
  results,
  combinedLoading,
  resultsRef,
}: Params) {
  useEffect(() => {
    if (viewMode !== 'combined' || results?.combinable !== false) return;
    const frame = requestAnimationFrame(() => {
      setViewMode('separated');
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [results?.combinable, setViewMode, viewMode]);

  const handleViewModeChange = useCallback(
    (nextMode: 'separated' | 'combined') => {
      if (nextMode === viewMode) return;
      const anchor = resultsRef.current;
      const previousTop = anchor?.getBoundingClientRect().top ?? 0;
      const previousScrollY = window.scrollY;
      if (anchor) {
        anchor.style.minHeight = `${String(anchor.getBoundingClientRect().height)}px`;
      }
      setViewMode(nextMode);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const nextAnchor = resultsRef.current;
          if (nextAnchor) {
            const delta = nextAnchor.getBoundingClientRect().top - previousTop;
            if (Math.abs(delta) > 1) window.scrollTo({ top: previousScrollY + delta });
            nextAnchor.style.minHeight = '';
          }
        });
      });
    },
    [resultsRef, setViewMode, viewMode],
  );

  return { combinedLoading, handleViewModeChange };
}
