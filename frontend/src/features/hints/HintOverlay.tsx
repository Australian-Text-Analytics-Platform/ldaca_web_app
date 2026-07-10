import { useEffect, useRef, useState } from 'react';

import { HighlightRing } from './HighlightRing';
import { HintBubble, type HintBubblePosition } from './HintBubble';
import type { HintDefinition } from './types';

interface HintOverlayProps {
  hint: HintDefinition;
  target: Element;
  /** Poll revisions request a measurement without reinstalling DOM listeners. */
  measurementRevision: number;
  onDismissPermanent: () => void;
  onDismissSession: () => void;
  onLearnMore?: () => void;
}

const BUBBLE_GAP = 12;
const VIEWPORT_MARGIN = 12;

function computePosition(
  rect: DOMRect,
  bubbleRect: { width: number; height: number },
  preferred: HintDefinition['placement'] = 'bottom',
): HintBubblePosition {
  const order: NonNullable<HintDefinition['placement']>[] =
    preferred === 'top'
      ? ['top', 'bottom', 'right', 'left']
      : preferred === 'left'
        ? ['left', 'right', 'bottom', 'top']
        : preferred === 'right'
          ? ['right', 'left', 'bottom', 'top']
          : ['bottom', 'top', 'right', 'left'];

  for (const side of order) {
    const top =
      side === 'bottom'
        ? rect.bottom + BUBBLE_GAP
        : side === 'top'
          ? rect.top - BUBBLE_GAP - bubbleRect.height
          : rect.top + rect.height / 2 - bubbleRect.height / 2;
    const left =
      side === 'right'
        ? rect.right + BUBBLE_GAP
        : side === 'left'
          ? rect.left - BUBBLE_GAP - bubbleRect.width
          : rect.left + rect.width / 2 - bubbleRect.width / 2;
    const fits =
      top >= VIEWPORT_MARGIN &&
      left >= VIEWPORT_MARGIN &&
      top + bubbleRect.height <= window.innerHeight - VIEWPORT_MARGIN &&
      left + bubbleRect.width <= window.innerWidth - VIEWPORT_MARGIN;
    if (fits) return { top, left, side };
  }

  return {
    top: Math.max(
      VIEWPORT_MARGIN,
      Math.min(rect.bottom + BUBBLE_GAP, window.innerHeight - bubbleRect.height - VIEWPORT_MARGIN),
    ),
    left: Math.max(
      VIEWPORT_MARGIN,
      Math.min(
        rect.left + rect.width / 2 - bubbleRect.width / 2,
        window.innerWidth - bubbleRect.width - VIEWPORT_MARGIN,
      ),
    ),
    side: preferred,
  };
}

/**
 * Shared measurement owner for a hint's ring and bubble. It installs one
 * scroll listener, one resize listener, and one ResizeObserver for the active
 * target/bubble pair; polling revisions only invoke the existing measurer.
 */
export function HintOverlay({
  hint,
  target,
  measurementRevision,
  onDismissPermanent,
  onDismissSession,
  onLearnMore,
}: HintOverlayProps) {
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<() => void>(() => undefined);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [bubblePosition, setBubblePosition] = useState<HintBubblePosition | null>(null);

  useEffect(() => {
    let animationFrame = 0;
    const measure = () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => {
        if (!target.isConnected) {
          setTargetRect(null);
          setBubblePosition(null);
          return;
        }
        const nextTargetRect = target.getBoundingClientRect();
        if (nextTargetRect.width === 0 && nextTargetRect.height === 0) return;
        const bubble = bubbleRef.current;
        const bubbleRect = bubble
          ? { width: bubble.offsetWidth, height: bubble.offsetHeight }
          : { width: 320, height: 160 };
        setTargetRect(nextTargetRect);
        setBubblePosition(computePosition(nextTargetRect, bubbleRect, hint.placement));
      });
    };
    measureRef.current = measure;
    measure();
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    const observer = new ResizeObserver(measure);
    observer.observe(target);
    if (bubbleRef.current) observer.observe(bubbleRef.current);
    return () => {
      measureRef.current = () => undefined;
      cancelAnimationFrame(animationFrame);
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
      observer.disconnect();
    };
  }, [target, hint.placement]);

  useEffect(() => {
    measureRef.current();
  }, [measurementRevision]);

  return (
    <>
      {targetRect ? <HighlightRing rect={targetRect} /> : null}
      <HintBubble
        hint={hint}
        bubbleRef={bubbleRef}
        position={bubblePosition}
        onDismissPermanent={onDismissPermanent}
        onDismissSession={onDismissSession}
        onLearnMore={onLearnMore}
      />
    </>
  );
}
