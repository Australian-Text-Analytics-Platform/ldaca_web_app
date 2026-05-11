import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Shared "drag-to-resize between two stacked panels" hook for horizontal
 * splits (top/bottom panes, horizontal separator).
 *
 * Two perf modes:
 *
 * 1. **State-driven (default)** — every pointer-move commits the new
 *    ratio to React state. Cheapest API, fine when the panes are
 *    flex/grid layouts whose children re-render cheaply (DataLoader's
 *    file tree + workspace manager cards).
 *
 * 2. **DOM-imperative (opt-in via `panelRefs`)** — during the drag, the
 *    pane DOM nodes' height styles are mutated directly via refs;
 *    React state is only updated on pointerUp. Used by WorkspaceView
 *    where the graph view (React Flow) and data table are expensive to
 *    re-render every frame. Pass `panelRefs={ primary, secondary }` and
 *    apply your `style.height`/`flexBasis` based on `ratio` in the JSX —
 *    the drag itself stays off the React render path.
 *
 * Vertical (column) splits aren't supported yet; App.tsx's sidebar and
 * right-panel resizers are still hand-rolled.
 */

type PanelRefs = {
  primary: React.RefObject<HTMLElement | null>;
  secondary: React.RefObject<HTMLElement | null>;
};

type UseResizableSplitOptions = {
  defaultRatio?: number;
  min?: number;
  max?: number;
  /**
   * When provided, the hook writes `style.height` on these refs during
   * pointer-move (commit-on-release model). When omitted, the hook
   * commits to React state on every move (live model).
   */
  panelRefs?: PanelRefs;
};

export type ResizableSplitHandle = {
  containerRef: React.RefObject<HTMLDivElement | null>;
  ratio: number;
  /** Convenience alias for legacy callers; same value as `ratio`. */
  topRatio: number;
  setRatio: React.Dispatch<React.SetStateAction<number>>;
  /** True while a drag is in flight — useful for cursor/visual state. */
  isDragging: boolean;
  splitterProps: {
    role: 'separator';
    'aria-orientation': 'horizontal';
    'aria-valuenow': number;
    'aria-valuemin': number;
    'aria-valuemax': number;
    tabIndex: 0;
    onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
    onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
    onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => void;
    onPointerCancel: (event: React.PointerEvent<HTMLDivElement>) => void;
    onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
    onDoubleClick: () => void;
  };
};

export function useResizableSplit({
  defaultRatio = 0.4,
  min = 0.15,
  max = 0.85,
  panelRefs,
}: UseResizableSplitOptions = {}): ResizableSplitHandle {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const liveRatioRef = useRef(defaultRatio);
  const rafIdRef = useRef<number | null>(null);
  // Mirror `panelRefs` into our own ref so the move handler can read the
  // caller's pane DOM nodes without taking the caller's object as a
  // dependency (and tripping react-hooks/immutability).
  const panelRefsRef = useRef<PanelRefs | undefined>(panelRefs);
  const [ratio, setRatio] = useState(defaultRatio);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    panelRefsRef.current = panelRefs;
  }, [panelRefs]);

  const clamp = useCallback((value: number) => Math.min(max, Math.max(min, value)), [min, max]);

  // Cancel any pending rAF on unmount so a stale handle doesn't fire after the
  // component unmounts mid-drag.
  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
    };
  }, []);

  const applyToPanels = useCallback((next: number) => {
    const refs = panelRefsRef.current;
    if (!refs) return;
    const primary = refs.primary.current;
    const secondary = refs.secondary.current;
    if (primary) primary.style.height = `${next * 100}%`;
    if (secondary) secondary.style.height = `${(1 - next) * 100}%`;
  }, []);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    draggingRef.current = true;
    setIsDragging(true);
    liveRatioRef.current = ratio;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // ignore pointer capture errors
    }
  }, [ratio]);

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      if (rect.height <= 0) return;
      const offset = event.clientY - rect.top;
      const next = clamp(offset / rect.height);
      liveRatioRef.current = next;

      if (panelRefsRef.current) {
        // DOM-imperative mode: coalesce updates with rAF so we don't
        // do more than one style write per frame.
        if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = requestAnimationFrame(() => {
          applyToPanels(liveRatioRef.current);
        });
      } else {
        setRatio(next);
      }
    },
    [clamp, applyToPanels],
  );

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setIsDragging(false);
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    // Commit the final ratio. In DOM-imperative mode the inline style
    // is reset implicitly: the next render writes `${ratio * 100}%`
    // again and React reconciles.
    setRatio(liveRatioRef.current);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // ignore pointer capture errors
    }
  }, []);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setRatio((prev) => clamp(prev - 0.05));
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        setRatio((prev) => clamp(prev + 0.05));
      } else if (event.key === 'Home') {
        event.preventDefault();
        setRatio(min);
      } else if (event.key === 'End') {
        event.preventDefault();
        setRatio(max);
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        setRatio(0.5);
      }
    },
    [clamp, min, max],
  );

  const onDoubleClick = useCallback(() => setRatio(0.5), []);

  const splitterProps: ResizableSplitHandle['splitterProps'] = {
    role: 'separator',
    'aria-orientation': 'horizontal',
    'aria-valuenow': Math.round(ratio * 100),
    'aria-valuemin': Math.round(min * 100),
    'aria-valuemax': Math.round(max * 100),
    tabIndex: 0,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
    onKeyDown,
    onDoubleClick,
  };

  return { containerRef, ratio, topRatio: ratio, setRatio, isDragging, splitterProps };
}
