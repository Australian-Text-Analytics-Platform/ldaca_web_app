import { useEffect, useState } from 'react';

/**
 * Subscribe to the clientWidth of a referenced element via ResizeObserver.
 *
 * Returns ``0`` until the ref attaches and the first measurement lands. Use
 * the returned width to drive responsive layouts inside components whose
 * container width changes with the panel layout (e.g. word clouds that should
 * fill their card rather than rendering at a fixed pixel size).
 *
 * No-ops in environments without ResizeObserver (older test runners), in
 * which case the width stays at its initial measurement after mount.
 */
/**
 * Used by: src/features/views/token-frequency/components/results/TokenFrequencySingleTokenSection.tsx, src/features/views/token-frequency/components/results/TokenFrequencyUnifiedTokenSection.tsx because the library needs this local step to isolate browser, data, or runtime edge cases for importers.
 * Flow: validate inputs, normalize values, branch on runtime conditions, then return the shared result.
 */
export function useElementWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    /**
     * Feeds consumers the current element width without forcing layout logic into each feature.
     * Why: importers need one shared normalization boundary to keep behavior consistent.
     */
    const measure = () => {
      setWidth(element.clientWidth);
    };
    measure();

    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => {
      measure();
    });
    observer.observe(element);
    return () => { observer.disconnect(); };
  }, [ref]);

  return width;
}
