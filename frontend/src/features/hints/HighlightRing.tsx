import { cn } from '@/lib/utils';

interface HighlightRingProps {
  /** Viewport-relative bounds measured by the shared hint overlay owner. */
  rect: DOMRect;
  className?: string;
}

/**
 * Presentational coach-mark ring. `HintOverlay` owns measurement, observers,
 * and viewport listeners so the ring never installs a parallel DOM lifecycle.
 */
export function HighlightRing({ rect, className }: HighlightRingProps) {
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
}
