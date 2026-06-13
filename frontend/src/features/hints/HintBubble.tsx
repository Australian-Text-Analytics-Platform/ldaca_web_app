import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { HintDefinition } from './types';

interface HintBubbleProps {
  hint: HintDefinition;
  target: Element;
  tick: number;
  onDismissPermanent: () => void;
  onDismissSession: () => void;
  onLearnMore?: () => void;
  onAction?: () => void;
}

interface Position {
  top: number;
  left: number;
  side: 'top' | 'bottom' | 'left' | 'right';
}

const BUBBLE_GAP = 12;
const VIEWPORT_MARGIN = 12;

/**
 * Computes a viewport-safe position for the visible hint bubble. `HintBubble`
 * uses it after measuring the target and bubble so coach marks stay attached
 * to their controls without clipping off-screen.
 * Used by: local callers in hints/HintBubble module because nearby helpers need the same normalization, formatting, or adapter rule without duplicating it.
 * Steps: measure bubble and target rectangles, choose a side that fits the viewport, clamp
 * coordinates, and return arrow offsets for the bubble.
 */
function computePosition(
  rect: DOMRect,
  bubbleRect: { width: number; height: number },
  preferred: HintDefinition['placement'] = 'bottom',
): Position {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const order: NonNullable<HintDefinition['placement']>[] =
    preferred === 'top'
      ? ['top', 'bottom', 'right', 'left']
      : preferred === 'left'
        ? ['left', 'right', 'bottom', 'top']
        : preferred === 'right'
          ? ['right', 'left', 'bottom', 'top']
          : ['bottom', 'top', 'right', 'left'];

  for (const side of order) {
    let top: number;
    let left: number;
    if (side === 'bottom') {
      top = rect.bottom + BUBBLE_GAP;
      left = rect.left + rect.width / 2 - bubbleRect.width / 2;
    } else if (side === 'top') {
      top = rect.top - BUBBLE_GAP - bubbleRect.height;
      left = rect.left + rect.width / 2 - bubbleRect.width / 2;
    } else if (side === 'right') {
      top = rect.top + rect.height / 2 - bubbleRect.height / 2;
      left = rect.right + BUBBLE_GAP;
    } else {
      top = rect.top + rect.height / 2 - bubbleRect.height / 2;
      left = rect.left - BUBBLE_GAP - bubbleRect.width;
    }

    const fits =
      top >= VIEWPORT_MARGIN &&
      left >= VIEWPORT_MARGIN &&
      top + bubbleRect.height <= vh - VIEWPORT_MARGIN &&
      left + bubbleRect.width <= vw - VIEWPORT_MARGIN;
    if (fits) {
      return { top, left, side };
    }
  }

  // Fallback: clamp to viewport on the preferred side.
  const top = Math.max(
    VIEWPORT_MARGIN,
    Math.min(rect.bottom + BUBBLE_GAP, vh - bubbleRect.height - VIEWPORT_MARGIN),
  );
  const left = Math.max(
    VIEWPORT_MARGIN,
    Math.min(
      rect.left + rect.width / 2 - bubbleRect.width / 2,
      vw - bubbleRect.width - VIEWPORT_MARGIN,
    ),
  );
  return { top, left, side: preferred };
}

/**
 * The visible coach-mark bubble. Portalled to <body>, positioned near the
 * target element. Uses fixed positioning + viewport math; intentionally
 * lightweight so it composes with our existing dialogs without focus-trap
 * or pointer-event conflicts.
 * Rendered by: HintsController module (rg call sites/imports) because the parent needs this component boundary to keep feature controls and state presentation isolated.
 * Flow: compute position from target and tick, render text/actions/dismiss controls, and
 * remeasure when the anchor or viewport changes.
 */
export function HintBubble({
  hint,
  target,
  tick,
  onDismissPermanent,
  onDismissSession,
  onLearnMore,
  onAction,
}: HintBubbleProps) {
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<Position | null>(null);

  useEffect(() => {
    let raf = 0;
    /**
     * Positions the bubble beside the target after layout and viewport changes.
     * Called by: HintBubble internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
     * Flow: schedule measurement in animation frame, skip detached anchors, measure fallback bubble bounds, and commit computed placement.
     */
    const measure = () => {
      raf = requestAnimationFrame(() => {
        const rect = target.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) {
          // Element not laid out yet (display:none or detached). Try again on
          // the next tick rather than committing a junk position.
          return;
        }
        const node = bubbleRef.current;
        const bubbleRect = node
          ? { width: node.offsetWidth, height: node.offsetHeight }
          : { width: 320, height: 160 };
        setPos(computePosition(rect, bubbleRect, hint.placement));
      });
    };
    measure();
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    const ro = new ResizeObserver(measure);
    ro.observe(target);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
      ro.disconnect();
    };
  }, [target, tick, hint.placement]);

  const style: React.CSSProperties = pos
    ? { position: 'fixed', top: pos.top, left: pos.left, zIndex: 70 }
    : {
        // Render before measurement using a viewport fallback rather than
        // off-screen — ensures the bubble is visible even if the measurement
        // effect is delayed (e.g. very slow layouts).
        position: 'fixed',
        top: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 70,
        opacity: 0,
      };

  return (
    <div
      ref={bubbleRef}
      role="dialog"
      data-hint-bubble="true"
      aria-live="polite"
      aria-labelledby={`hint-title-${hint.id}`}
      style={style}
      className={cn(
        'pointer-events-auto w-80 max-w-[calc(100vw-1.5rem)] rounded-lg border border-blue-300 bg-white p-4 text-foreground shadow-xl',
        'dark:bg-slate-900 dark:border-blue-700 dark:text-slate-100',
      )}
    >
      <div id={`hint-title-${hint.id}`} className="mb-1 text-sm font-semibold">
        {hint.title}
      </div>
      <p className="mb-3 text-sm text-muted-foreground">{hint.body}</p>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {hint.learnMoreTarget && onLearnMore && (
          <Button variant="link" size="sm" className="h-7 px-1 text-xs" onClick={onLearnMore}>
            Learn more
          </Button>
        )}
        {hint.action && onAction && (
          <Button size="sm" className="h-7 px-2 text-xs" onClick={onAction}>
            {hint.action.label}
          </Button>
        )}
        {hint.oneShot === false ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={onDismissPermanent}
              title="Don't show this hint again"
            >
              Don&rsquo;t show again
            </Button>
            <Button
              variant="default"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={onDismissSession}
            >
              Got it
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={onDismissSession}
            >
              Dismiss
            </Button>
            <Button
              variant="default"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={onDismissPermanent}
            >
              Got it
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
