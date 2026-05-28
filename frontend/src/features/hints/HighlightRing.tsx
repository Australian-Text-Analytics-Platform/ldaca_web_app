import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

interface HighlightRingProps {
  /** Element to highlight. Position is read once per `tick` increment. */
  target: Element;
  /** Increment to force re-measurement (e.g. on scroll/resize). */
  tick: number;
  className?: string;
}

/**
   * A non-interactive highlight ring portalled to <body> and absolutely
   * positioned over the target element's bounding rect. Updates on scroll,
   * resize, and external `tick` changes. Pure presentational — does not own
   * lifecycle of the target.
   * Rendered by: HintsController module (rg call sites/imports) because the parent needs this component boundary to keep feature controls and state presentation isolated.
   * Flow: measure the target on every tick/resize/scroll, store viewport-relative bounds, and
   * render an overlay only while the anchor is still attached.
   */
export const HighlightRing: React.FC<HighlightRingProps> = ({
  target,
  tick,
  className,
}) => {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    let raf = 0;
        /**
         * Remeasures the highlighted target for scroll, resize, and layout changes.
         * Called by: HighlightRing internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
         */
    const measure = () => {
      raf = requestAnimationFrame(() => setRect(target.getBoundingClientRect()));
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
  }, [target, tick]);

  if (!rect) return null;

  // Outset the ring slightly so it visually frames the target without
  // covering its border. Pointer-events disabled so clicks pass through to
  // the underlying control (so users can act on the highlighted button).
  const pad = 6;
  const style: React.CSSProperties = {
    position: 'fixed',
    top: rect.top - pad,
    left: rect.left - pad,
    width: rect.width + pad * 2,
    height: rect.height + pad * 2,
    pointerEvents: 'none',
    zIndex: 60,
    borderRadius: 8,
    boxShadow:
      '0 0 0 3px rgb(59 130 246 / 0.9), 0 0 0 6px rgb(255 255 255 / 0.9), 0 0 0 9999px rgb(15 23 42 / 0.35)',
  };

  return (
    <div
      aria-hidden="true"
      data-testid="hint-highlight-ring"
      style={style}
      className={cn('motion-safe:animate-pulse', className)}
    />
  );
};

export default HighlightRing;
