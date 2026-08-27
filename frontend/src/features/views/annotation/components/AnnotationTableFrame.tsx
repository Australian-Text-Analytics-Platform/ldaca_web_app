import type React from 'react';
import { useState } from 'react';
import { ResizeHandle } from '@/components/layout/ResizeHandle';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import {
  ANNOTATION_TABLE_DEFAULT_HEIGHT,
  ANNOTATION_TABLE_MAX_VIEWPORT_RATIO,
  clampAnnotationTableHeight,
} from '../annotationTableHeight';

const KEYBOARD_STEP = 24;

interface AnnotationTableFrameProps {
  /** Persisted per-tab height in pixels; null renders the default height. */
  height: number | null;
  /** Receives the committed height after a drag, keyboard nudge, or double-click reset (null). */
  onHeightChange: (height: number | null) => void;
  children: React.ReactNode;
  belowTable?: React.ReactNode;
  contentClassName?: string;
  viewportRef?: React.Ref<HTMLDivElement>;
}

/**
 * Resizable, always-scrollable shell shared by the Annotation Manual, Preview, and Review tables.
 * Flow: the table scrolls inside a viewport whose max height is the lesser of the persisted
 * height and 75% of the window (CSS `min()` re-clamps on window resize); the bottom handle
 * drags, nudges by keyboard, or double-clicks back to the default. Live drag height stays local
 * and is committed through onHeightChange on release so the Tab persists one shared value.
 */
export function AnnotationTableFrame({
  height,
  onHeightChange,
  children,
  belowTable,
  contentClassName = 'min-w-full',
  viewportRef,
}: AnnotationTableFrameProps) {
  const [drag, setDrag] = useState<{
    pointerId: number;
    startY: number;
    startHeight: number;
    height: number;
  } | null>(null);
  const committedHeight = clampAnnotationTableHeight(height ?? ANNOTATION_TABLE_DEFAULT_HEIGHT);
  const liveHeight = drag?.height ?? committedHeight;

  return (
    <div className="overflow-hidden rounded-lg border border-surface-border bg-surface">
      <ScrollArea
        viewportRef={viewportRef}
        scrollbars="both"
        type="always"
        data-testid="analysis-table-scroll-area"
        data-table-height={liveHeight}
        style={{
          maxHeight: `min(${String(liveHeight)}px, ${String(ANNOTATION_TABLE_MAX_VIEWPORT_RATIO * 100)}vh)`,
        }}
      >
        <div className={cn(contentClassName)}>{children}</div>
      </ScrollArea>
      <ResizeHandle
        orientation="horizontal"
        variant="grip"
        isDragging={drag !== null}
        aria-label="Resize annotation table"
        aria-valuenow={liveHeight}
        aria-valuemin={ANNOTATION_TABLE_DEFAULT_HEIGHT}
        tabIndex={0}
        title="Drag to resize. Double-click to reset."
        className="border-t border-surface-border"
        data-testid="annotation-table-resize-handle"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          if (typeof event.currentTarget.setPointerCapture === 'function') {
            event.currentTarget.setPointerCapture(event.pointerId);
          }
          setDrag({
            pointerId: event.pointerId,
            startY: event.clientY,
            startHeight: committedHeight,
            height: committedHeight,
          });
        }}
        onPointerMove={(event) => {
          if (drag?.pointerId !== event.pointerId) return;
          const next = clampAnnotationTableHeight(drag.startHeight + event.clientY - drag.startY);
          if (next !== drag.height) setDrag({ ...drag, height: next });
        }}
        onPointerUp={(event) => {
          if (drag?.pointerId !== event.pointerId) return;
          if (typeof event.currentTarget.releasePointerCapture === 'function') {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
          setDrag(null);
          if (drag.height !== committedHeight) onHeightChange(drag.height);
        }}
        onPointerCancel={() => {
          setDrag(null);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
          event.preventDefault();
          const delta = event.key === 'ArrowDown' ? KEYBOARD_STEP : -KEYBOARD_STEP;
          const next = clampAnnotationTableHeight(committedHeight + delta);
          if (next !== committedHeight) onHeightChange(next);
        }}
        onDoubleClick={() => {
          onHeightChange(null);
        }}
      />
      {belowTable}
    </div>
  );
}
