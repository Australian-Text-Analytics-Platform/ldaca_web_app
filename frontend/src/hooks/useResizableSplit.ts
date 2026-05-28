import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Shared drag-to-resize hook for splitter UIs.
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
export type ResizableSplitAnchor = 'start' | 'end';

type UseResizableSplitOptions = {
  /** Default 'horizontal' (top/bottom panes). */
  orientation?: ResizableSplitOrientation;
  /** Default 'percent'. */
  mode?: ResizableSplitMode;
  /**
   * Which pane the `value` represents.
   * - 'start' (default) — the value tracks the top/left pane: a value of
   *   0.6 means "top/left pane takes 60% of the container".
   * - 'end' — the value tracks the bottom/right pane. Useful when the
   *   sensible cap (`maxPixels`) belongs to that pane (e.g. a right-anchored
   *   workspace view that shouldn't grow past 800 px on ultrawide screens).
   */
  anchor?: ResizableSplitAnchor;
  /** Initial value: ratio (`0..1`) or pixels, depending on `mode`. */
  defaultValue: number;
  min?: number;
  max?: number;
  /**
   * Percent mode only. Adaptive cap in pixels on the value's anchored pane:
   * the effective max becomes `min(max, maxPixels / containerSize)`, so an
   * ultrawide screen doesn't stretch the pane past `maxPixels`. Example:
   * `anchor: 'end', max: 0.8, maxPixels: 800` — the end-anchored pane is
   * up to 80%, but never more than 800 px wide.
   */
  maxPixels?: number;
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
  /**
   * When set, the hook reads the initial value from `localStorage[persistKey]`
   * (falling back to `defaultValue` if missing/invalid) and writes the
   * committed value back on every change. Storage is sync; failures are
   * silent (Safari private mode, etc).
   */
  persistKey?: string;
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

/** Reads a persisted split value while tolerating private-mode/localStorage failures. */
/** Called by: useResizableSplit in this hook module because the hook needs local steps to normalize inputs before exposing stable state to consumers. */
const readPersisted = (key: string | undefined, fallback: number): number => {
  if (!key || typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
};

/** Persists committed split values so layout sizing survives reloads. */
/** Called by: useResizableSplit in this hook module because the hook needs local steps to normalize inputs before exposing stable state to consumers. */
const writePersisted = (key: string | undefined, value: number) => {
  if (!key || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // ignore storage errors (Safari private mode, etc.)
  }
};

/** Provides state, DOM refs, keyboard handlers, and pointer handlers for resizable panes. */
/**
 * Used by: src/App.tsx, src/components/layout/WorkspaceView.tsx, src/features/data-loader/DataLoaderFeature.tsx because the hook needs local steps to normalize inputs before exposing stable state to consumers.
 * Flow: initialize persisted split value, clamp pointer and keyboard updates, capture splitter events, then expose value, drag state, refs, and ARIA props.
 */
export function useResizableSplit({
  orientation = 'horizontal',
  mode = 'percent',
  anchor = 'start',
  defaultValue,
  min: minOpt,
  max: maxOpt,
  maxPixels,
  onLiveUpdate,
  onDragStart,
  onDragEnd,
  keyboardStep,
  persistKey,
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
  // Lazy initializer so we read localStorage exactly once on mount,
  // then drive state through normal setValue paths.
  const [value, setValue] = useState(() => readPersisted(persistKey, defaultValue));
  const liveValueRef = useRef(value);
  const rafIdRef = useRef<number | null>(null);
  // Mirror the live callbacks into refs so the per-pointer-event closures
  // can read the latest version without listing them as deps (and
  // tripping react-hooks/immutability).
  const onLiveUpdateRef = useRef(onLiveUpdate);
  const onDragStartRef = useRef(onDragStart);
  const onDragEndRef = useRef(onDragEnd);
  const [isDragging, setIsDragging] = useState(false);

  // Write committed value to localStorage on every change. Skips the
  // initial commit since the value came from persistence in the first
  // place; subsequent renders pay the cost of a setItem call (cheap).
  useEffect(() => {
    if (!persistKey) return;
    writePersisted(persistKey, value);
  }, [persistKey, value]);

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

  /**
   * Clamp a value against [min, max] plus the adaptive `maxPixels` cap
   * (percent mode only). `containerSize` is the long-axis size of the
   * container (height for horizontal split, width for vertical) — passed
   * in so the pointer-move path can use the live rect without a second
   * getBoundingClientRect().
   */
  const clamp = useCallback(
    (v: number, containerSize?: number): number => {
      let effectiveMax = max;
      if (
        mode === 'percent' &&
        typeof maxPixels === 'number' &&
        typeof containerSize === 'number' &&
        containerSize > 0
      ) {
        effectiveMax = Math.min(effectiveMax, maxPixels / containerSize);
      }
      return Math.min(effectiveMax, Math.max(min, v));
    },
    [min, max, mode, maxPixels],
  );

  /** Converts pointer coordinates into the split value represented by the configured anchor/mode. */
  const computeFromPointer = useCallback(
    (event: { clientX: number; clientY: number }): number | null => {
      const container = containerRef.current;
      if (!container) return null;
      const rect = container.getBoundingClientRect();
      if (orientation === 'horizontal') {
        if (rect.height <= 0) return null;
        const offsetFromStart = event.clientY - rect.top;
        // anchor='end' flips the offset so the value represents the
        // distance from the END (bottom) edge instead of the start.
        const anchored = anchor === 'end' ? rect.height - offsetFromStart : offsetFromStart;
        return clamp(mode === 'percent' ? anchored / rect.height : anchored, rect.height);
      }
      if (rect.width <= 0) return null;
      const offsetFromStart = event.clientX - rect.left;
      const anchored = anchor === 'end' ? rect.width - offsetFromStart : offsetFromStart;
      return clamp(mode === 'percent' ? anchored / rect.width : anchored, rect.width);
    },
    [orientation, anchor, mode, clamp],
  );

  /** Starts a drag interaction and captures the pointer for reliable splitter movement. */
  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
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
    },
    [value],
  );

  /** Streams drag updates either through DOM-imperative callbacks or hook state. */
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

  /** Commits the live drag value and releases pointer capture when resizing ends. */
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

  /** Provides keyboard resizing semantics for accessible separator controls. */
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      // ArrowUp/ArrowLeft moves the splitter toward the START edge of the
      // container; ArrowDown/ArrowRight moves it toward the END. For
      // anchor='start', moving startward shrinks the value; for
      // anchor='end', it grows the value (the end pane gets bigger as the
      // splitter moves away from it… err, no — as the splitter moves
      // toward the START edge, the END pane grows). Sign flip via anchor.
      const isStartward =
        orientation === 'horizontal' ? event.key === 'ArrowUp' : event.key === 'ArrowLeft';
      const isEndward =
        orientation === 'horizontal' ? event.key === 'ArrowDown' : event.key === 'ArrowRight';
      const startwardDelta = anchor === 'end' ? +step : -step;
      const endwardDelta = anchor === 'end' ? -step : +step;
      if (isStartward) {
        event.preventDefault();
        setValue((prev) => clamp(prev + startwardDelta));
      } else if (isEndward) {
        event.preventDefault();
        setValue((prev) => clamp(prev + endwardDelta));
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
    [orientation, anchor, clamp, step, min, max, mode, defaultValue],
  );

  /** Resets the split to its default/midpoint for users who overshoot a drag. */
  const onDoubleClick = useCallback(() => {
    setValue(mode === 'percent' ? 0.5 : defaultValue);
  }, [mode, defaultValue]);

  // ARIA value reporting: clamp to a 0..100 integer scale so screen readers
  // get a sensible % regardless of mode.
  const reportedNow = mode === 'percent' ? value * 100 : value;
  const reportedMin = mode === 'percent' ? min * 100 : Number.isFinite(min) ? min : 0;
  const reportedMax = mode === 'percent' ? max * 100 : Number.isFinite(max) ? max : 100;

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
