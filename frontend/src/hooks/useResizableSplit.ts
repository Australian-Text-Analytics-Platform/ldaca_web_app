import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Shared drag-to-resize hook for splitter UIs. Phase A unification:
 * covers the three previously hand-rolled implementations (DataLoader's
 * top/bottom percent split, WorkspaceView's top/bottom percent split,
 * App.tsx's sidebar pixel column + right-panel percent column).
 *
 * Axes:
 * - `orientation: 'horizontal'` — panes are stacked top/bottom, the
 *   separator is a horizontal line, drag moves on the Y axis.
 *   `aria-orientation='horizontal'`, ArrowUp/ArrowDown nudge.
 * - `orientation: 'vertical'` — panes are side-by-side, the separator
 *   is a vertical line, drag moves on the X axis.
 *   `aria-orientation='vertical'`, ArrowLeft/ArrowRight nudge.
 *
 * Modes:
 * - `mode: 'percent'` — value is a ratio in `[0, 1]` of the container's
 *   long axis. Good for content panes that should scale with screen size.
 * - `mode: 'pixel'` — value is the absolute pixel offset from the
 *   container's start edge, clamped to `[min, max]`. Good for fixed-cost
 *   rails (sidebars) whose content doesn't grow with screen size.
 *
 * Two perf modes (orthogonal to the above):
 * - **State-driven (default)** — every pointer-move calls `setValue`.
 *   Cheapest API; fine when the panes' children re-render cheaply.
 * - **DOM-imperative** — pass `onLiveUpdate` (and optionally
 *   `onDragStart`/`onDragEnd`). The callback runs once per rAF during
 *   the drag; the hook still commits the final value to state on
 *   pointerUp. Use this when a child is expensive to re-render (React
 *   Flow, TanStack tables, etc.).
 */

export type ResizableSplitOrientation = 'horizontal' | 'vertical';
export type ResizableSplitMode = 'percent' | 'pixel';

type UseResizableSplitOptions = {
  /** Default 'horizontal' (top/bottom panes). */
  orientation?: ResizableSplitOrientation;
  /** Default 'percent'. */
  mode?: ResizableSplitMode;
  /** Initial value: ratio (`0..1`) or pixels, depending on `mode`. */
  defaultValue: number;
  min?: number;
  max?: number;
  /**
   * Called during the drag with the live value (rAF-coalesced). Use to
   * mutate DOM directly when child renders are expensive. The hook
   * still commits the final value via `setValue` on pointerUp.
   */
  onLiveUpdate?: (value: number) => void;
  /** Called once when the drag starts (e.g. to disable CSS transitions). */
  onDragStart?: () => void;
  /** Called once when the drag ends (e.g. to re-enable CSS transitions). */
  onDragEnd?: () => void;
  /**
   * Keyboard nudge step. Defaults: 0.05 (percent), 10 (pixel). Same units
   * as `defaultValue` / `min` / `max`.
   */
  keyboardStep?: number;
};

export type ResizableSplitHandle = {
  containerRef: React.RefObject<HTMLDivElement | null>;
  value: number;
  setValue: React.Dispatch<React.SetStateAction<number>>;
  isDragging: boolean;
  splitterProps: {
    role: 'separator';
    'aria-orientation': ResizableSplitOrientation;
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

const DEFAULT_PERCENT_MIN = 0.15;
const DEFAULT_PERCENT_MAX = 0.85;

export function useResizableSplit({
  orientation = 'horizontal',
  mode = 'percent',
  defaultValue,
  min: minOpt,
  max: maxOpt,
  onLiveUpdate,
  onDragStart,
  onDragEnd,
  keyboardStep,
}: UseResizableSplitOptions): ResizableSplitHandle {
  // Pick sensible defaults for the bounds when callers don't supply them.
  // Percent mode falls back to [0.15, 0.85]; pixel mode has no universal
  // sensible default, so we keep the value unclamped if the caller is
  // silent (treat as [-Infinity, Infinity]).
  const min = minOpt ?? (mode === 'percent' ? DEFAULT_PERCENT_MIN : Number.NEGATIVE_INFINITY);
  const max = maxOpt ?? (mode === 'percent' ? DEFAULT_PERCENT_MAX : Number.POSITIVE_INFINITY);
  const step = keyboardStep ?? (mode === 'percent' ? 0.05 : 10);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const liveValueRef = useRef(defaultValue);
  const rafIdRef = useRef<number | null>(null);
  // Mirror the live callbacks into refs so the per-pointer-event closures
  // can read the latest version without listing them as deps (and
  // tripping react-hooks/immutability).
  const onLiveUpdateRef = useRef(onLiveUpdate);
  const onDragStartRef = useRef(onDragStart);
  const onDragEndRef = useRef(onDragEnd);
  const [value, setValue] = useState(defaultValue);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    onLiveUpdateRef.current = onLiveUpdate;
    onDragStartRef.current = onDragStart;
    onDragEndRef.current = onDragEnd;
  }, [onLiveUpdate, onDragStart, onDragEnd]);

  // Cancel any pending rAF on unmount so a stale handle doesn't fire after
  // the component unmounts mid-drag.
  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
    };
  }, []);

  const clamp = useCallback((v: number) => Math.min(max, Math.max(min, v)), [min, max]);

  const computeFromPointer = useCallback(
    (event: { clientX: number; clientY: number }): number | null => {
      const container = containerRef.current;
      if (!container) return null;
      const rect = container.getBoundingClientRect();
      if (orientation === 'horizontal') {
        if (rect.height <= 0) return null;
        const offset = event.clientY - rect.top;
        return clamp(mode === 'percent' ? offset / rect.height : offset);
      }
      if (rect.width <= 0) return null;
      const offset = event.clientX - rect.left;
      return clamp(mode === 'percent' ? offset / rect.width : offset);
    },
    [orientation, mode, clamp],
  );

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    draggingRef.current = true;
    setIsDragging(true);
    liveValueRef.current = value;
    onDragStartRef.current?.();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // ignore pointer capture errors
    }
  }, [value]);

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      const next = computeFromPointer(event);
      if (next === null) return;
      liveValueRef.current = next;

      if (onLiveUpdateRef.current) {
        // DOM-imperative mode: coalesce updates with rAF so we don't do
        // more than one write per frame.
        if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = requestAnimationFrame(() => {
          onLiveUpdateRef.current?.(liveValueRef.current);
        });
      } else {
        setValue(next);
      }
    },
    [computeFromPointer],
  );

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setIsDragging(false);
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    setValue(liveValueRef.current);
    onDragEndRef.current?.();
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // ignore pointer capture errors
    }
  }, []);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const isPrev = orientation === 'horizontal' ? event.key === 'ArrowUp' : event.key === 'ArrowLeft';
      const isNext = orientation === 'horizontal' ? event.key === 'ArrowDown' : event.key === 'ArrowRight';
      if (isPrev) {
        event.preventDefault();
        setValue((prev) => clamp(prev - step));
      } else if (isNext) {
        event.preventDefault();
        setValue((prev) => clamp(prev + step));
      } else if (event.key === 'Home') {
        event.preventDefault();
        setValue(clamp(min));
      } else if (event.key === 'End') {
        event.preventDefault();
        setValue(clamp(max));
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        // Reset to default: midpoint for percent, defaultValue for pixel.
        setValue(mode === 'percent' ? 0.5 : defaultValue);
      }
    },
    [orientation, clamp, step, min, max, mode, defaultValue],
  );

  const onDoubleClick = useCallback(() => {
    setValue(mode === 'percent' ? 0.5 : defaultValue);
  }, [mode, defaultValue]);

  // ARIA value reporting: clamp to a 0..100 integer scale so screen readers
  // get a sensible % regardless of mode.
  const reportedNow = mode === 'percent' ? value * 100 : value;
  const reportedMin = mode === 'percent' ? min * 100 : (Number.isFinite(min) ? min : 0);
  const reportedMax = mode === 'percent' ? max * 100 : (Number.isFinite(max) ? max : 100);

  const splitterProps: ResizableSplitHandle['splitterProps'] = {
    role: 'separator',
    'aria-orientation': orientation,
    'aria-valuenow': Math.round(reportedNow),
    'aria-valuemin': Math.round(reportedMin),
    'aria-valuemax': Math.round(reportedMax),
    tabIndex: 0,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
    onKeyDown,
    onDoubleClick,
  };

  return { containerRef, value, setValue, isDragging, splitterProps };
}
