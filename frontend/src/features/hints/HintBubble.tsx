import type { RefObject } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { HintDefinition } from './types';

export interface HintBubblePosition {
  top: number;
  left: number;
  side: 'top' | 'bottom' | 'left' | 'right';
}

interface HintBubbleProps {
  hint: HintDefinition;
  bubbleRef: RefObject<HTMLDivElement | null>;
  position: HintBubblePosition | null;
  onDismissPermanent: () => void;
  onDismissSession: () => void;
  onLearnMore?: () => void;
}

/**
 * Presentational coach-mark dialog. `HintOverlay` supplies its measured
 * position and ref, leaving this component responsible only for accessible
 * copy and dismissal/navigation controls.
 */
export function HintBubble({
  hint,
  bubbleRef,
  position,
  onDismissPermanent,
  onDismissSession,
  onLearnMore,
}: HintBubbleProps) {
  const style: React.CSSProperties = position
    ? { position: 'fixed', top: position.top, left: position.left, zIndex: 70 }
    : {
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
        {hint.learnMoreTarget && onLearnMore ? (
          <Button variant="link" size="sm" className="h-7 px-1 text-xs" onClick={onLearnMore}>
            Learn more
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={onDismissPermanent}
          title="Don't show this hint again"
        >
          Don&rsquo;t show again
        </Button>
        <Button variant="default" size="sm" className="h-7 px-2 text-xs" onClick={onDismissSession}>
          Got it
        </Button>
      </div>
    </div>
  );
}
