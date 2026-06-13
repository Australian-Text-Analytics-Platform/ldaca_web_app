import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from 'react';

interface UseStackedSplitsOptions {
  /** Minimum pixel height a non-collapsed section can shrink to. Default 120. */
  minSectionPx?: number;
  /** Initial split ratios (must sum to ~1). Defaults to even distribution. */
  initialRatios?: Record<string, number>;
  /** Initial collapsed map. Defaults to all-expanded. */
  initialCollapsed?: Record<string, boolean>;
}

export interface StackedSplitsApi<KeyT extends string> {
  /** Attach to the wrapping flex column. ResizeObserver tracks its height. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Read accessor for the per-section collapse state. */
  isCollapsed: (key: KeyT) => boolean;
  /** Toggle a section's collapsed state. */
  toggleSection: (key: KeyT) => void;
  /**
   * Per-section flex style. Collapsed sections render at content height; the
   * remaining sections share the leftover space proportional to their ratio.
   */
  getSectionFlexStyle: (key: KeyT) => CSSProperties;
  /**
   * Pass to each section's inner scroll container so the drag handler can
   * push overflow into the right pane when the cursor moves past min/max.
   */
  assignSectionScrollRef: (key: KeyT, node: HTMLDivElement | null) => void;
  /**
   * Mousedown handler for the separator between `upperKey` (above) and
   * `lowerKey` (below). Resizes the pair against each other; if the cursor
   * tries to push past either pane's min, the overflow scrolls that pane.
   */
  handleResizeStart: (
    upperKey: KeyT,
    lowerKey: KeyT,
    event: ReactMouseEvent<HTMLDivElement>,
  ) => void;
}

/**
 * Hook used by the sidebar to manage collapsible, drag-resizable vertical
 * sections. It owns section ratios, collapse state, resize observation, and
 * overflow scrolling so the sidebar component can stay focused on rendering
 * views, nodes, and tasks.
 * Why: the sidebar needs collapsible, resizable vertical sections without mixing layout math into rendering code.
 * Flow: seed collapse and ratio state, observe container height, compute flex styles, and expose collapse, ref, and drag-resize handlers.
 */
export const useStackedSplits = <KeyT extends string>(
  keys: readonly KeyT[],
  options: UseStackedSplitsOptions = {},
): StackedSplitsApi<KeyT> => {
  const { minSectionPx = 120, initialRatios, initialCollapsed } = options;

  const defaultRatio = keys.length > 0 ? 1 / keys.length : 0;
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>(() => {
    const seed: Record<string, boolean> = {};
    keys.forEach((key) => {
      seed[key] = initialCollapsed?.[key] ?? false;
    });
    return seed;
  });
  const [sectionHeights, setSectionHeights] = useState<Record<string, number>>(() => {
    const seed: Record<string, number> = {};
    keys.forEach((key) => {
      seed[key] = initialRatios?.[key] ?? defaultRatio;
    });
    return seed;
  });

  const containerRef = useRef<HTMLDivElement | null>(null);
  const sectionScrollRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [containerHeight, setContainerHeight] = useState(0);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (typeof ResizeObserver === 'undefined') {
      setContainerHeight(container.getBoundingClientRect().height);
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setContainerHeight(entry.contentRect.height);
    });
    observer.observe(container);
    return () => { observer.disconnect(); };
  }, []);

  const activeSectionTotal = useMemo(() => {
    const total = keys.reduce((sum, key) => {
      if (collapsedSections[key]) return sum;
      return sum + (sectionHeights[key] ?? 0);
    }, 0);
    return total || 1;
  }, [keys, collapsedSections, sectionHeights]);

  const isCollapsed = useCallback(
    (key: KeyT) => Boolean(collapsedSections[key]),
    [collapsedSections],
  );

  const toggleSection = useCallback((key: KeyT) => {
    setCollapsedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const getSectionFlexStyle = useCallback(
    (key: KeyT): CSSProperties => {
      if (collapsedSections[key]) {
        return { flex: '0 0 auto' };
      }
      const ratio = (sectionHeights[key] ?? 0) / activeSectionTotal;
      return { flexGrow: ratio, flexShrink: 0, flexBasis: 0 };
    },
    [collapsedSections, sectionHeights, activeSectionTotal],
  );

  const assignSectionScrollRef = useCallback((key: KeyT, node: HTMLDivElement | null) => {
    sectionScrollRefs.current[key] = node;
  }, []);

  const scrollSection = useCallback((key: KeyT, deltaPixels: number) => {
    if (deltaPixels === 0) return;
    const target = sectionScrollRefs.current[key];
    if (!target) return;
    target.scrollTop += deltaPixels;
  }, []);

  const handleResizeStart = useCallback(
    (upperKey: KeyT, lowerKey: KeyT, event: ReactMouseEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      if (collapsedSections[upperKey] || collapsedSections[lowerKey]) return;
      const height = containerHeight || 1;
      if (height <= 0) return;

      event.preventDefault();
      const startY = event.clientY;
      const startUpper = sectionHeights[upperKey] ?? 0;
      const startLower = sectionHeights[lowerKey] ?? 0;
      const pairTotal = startUpper + startLower;
      if (pairTotal <= 0) return;

      const rawMinRatio = minSectionPx / height;
      const safeMinCandidate = Math.min(Math.max(rawMinRatio, 0.02), pairTotal / 2 - 0.01);
      if (
        !Number.isFinite(safeMinCandidate) ||
        safeMinCandidate <= 0 ||
        pairTotal - safeMinCandidate <= safeMinCandidate
      ) {
        return;
      }

      const minUpper = safeMinCandidate;
      const maxUpper = pairTotal - safeMinCandidate;

      /**
       * Called by: the window mousemove listener installed by handleResizeStart because the interaction needs a single handler that validates state, runs the action, and updates feedback.
       * Flow: convert mouse delta to section ratios, clamp the upper/lower pair, update heights, then scroll overflow when the drag hits a minimum bound.
       */
      const onMove = (moveEvent: MouseEvent) => {
        const deltaY = moveEvent.clientY - startY;
        const deltaRatio = deltaY / height;
        const candidateUpper = startUpper + deltaRatio;
        let nextUpper = candidateUpper;
        let overflowTarget: KeyT | null = null;
        let overflowRatio = 0;

        if (candidateUpper < minUpper) {
          nextUpper = minUpper;
          overflowTarget = upperKey;
          overflowRatio = candidateUpper - minUpper;
        } else if (candidateUpper > maxUpper) {
          nextUpper = maxUpper;
          overflowTarget = lowerKey;
          overflowRatio = candidateUpper - maxUpper;
        }

        const nextLower = pairTotal - nextUpper;
        setSectionHeights((prev) => ({
          ...prev,
          [upperKey]: nextUpper,
          [lowerKey]: nextLower,
        }));

        if (overflowTarget && overflowRatio !== 0) {
          scrollSection(overflowTarget, overflowRatio * height);
        }
      };

      /** Called by: the window mouseup listener installed by handleResizeStart because the interaction needs a single handler that validates state, runs the action, and updates feedback. */
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [collapsedSections, containerHeight, sectionHeights, minSectionPx, scrollSection],
  );

  return {
    containerRef,
    isCollapsed,
    toggleSection,
    getSectionFlexStyle,
    assignSectionScrollRef,
    handleResizeStart,
  };
};
