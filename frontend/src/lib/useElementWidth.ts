import { useEffect, useState } from 'react';

/**
 * Subscribe to the clientWidth of a referenced element via ResizeObserver.
 *
 * Returns ``0`` until the ref attaches and the first measurement lands. Use
 * the returned width to drive responsive layouts inside components whose
 * container width changes with the panel layout.
 *
 * No-ops in environments without ResizeObserver (older test runners), in
 * which case the width stays at its initial measurement after mount.
 */
/**
 * Used by: src/features/views/common/components/ResponsiveWordCloud.tsx.
 */
export function useElementWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    /**
     * Feeds consumers the current element width without forcing layout logic into each feature.
     * Called on mount and by the observer whenever the element is resized.
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
    return () => {
      observer.disconnect();
    };
  }, [ref]);

  return width;
}
