import React, { useRef, useState } from 'react';
import { WorkspaceGraphView } from './WorkspaceGraphView';
import { WorkspaceDataView } from './WorkspaceDataView';
import { WorkspaceControls } from './WorkspaceControls';
import { InsetCard } from './InsetCard';

/**
 * Stacked workspace view: graph on top, data table on bottom, with a
 * drag-to-resize separator. Split ratio is committed to state only on
 * mouseup — during the drag we mutate DOM heights directly via refs and
 * rAF to avoid React re-renders.
 */
const WorkspaceView: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [split, setSplit] = useState<number>(50); // percentage for top panel
  const [isDragging, setIsDragging] = useState(false);

  const onStartDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!containerRef.current) return;
    setIsDragging(true);
    const startY = e.clientY;
    const startPct = split;
    const containerHeight = containerRef.current.getBoundingClientRect().height;
    let rafId: number | null = null;
    let livePct = startPct;

    const onMove = (ev: MouseEvent) => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const deltaPct = ((ev.clientY - startY) / containerHeight) * 100;
        livePct = Math.min(80, Math.max(20, startPct + deltaPct));
        if (topRef.current) topRef.current.style.height = `${livePct}%`;
        if (bottomRef.current) bottomRef.current.style.height = `${100 - livePct}%`;
      });
    };
    const onUp = () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      setSplit(livePct);
      setIsDragging(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div className="flex flex-col h-full bg-transparent" ref={containerRef}>
      <InsetCard
        ref={topRef}
        className="min-h-30 p-2 pb-1"
        style={{ height: `calc(${split}% - 0.25rem)` }}
      >
        <div className="p-2 bg-muted border-b border-border shrink-0">
          <WorkspaceControls />
        </div>
        <div className="flex-1 min-h-0">
          <WorkspaceGraphView />
        </div>
      </InsetCard>

      <div
        className="h-2 shrink-0 cursor-row-resize relative group flex items-center justify-center"
        onMouseDown={onStartDrag}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize graph and data panels"
      >
        <div
          className={`pointer-events-none h-1 w-10 rounded-full transition-colors ${
            isDragging ? 'bg-gray-500' : 'bg-gray-300 group-hover:bg-gray-500'
          }`}
        />
      </div>

      <InsetCard
        ref={bottomRef}
        className="min-h-30 p-2 pt-1"
        style={{ height: `calc(${100 - split}% - 0.25rem)` }}
      >
        <div className="flex-1 min-h-0">
          <WorkspaceDataView />
        </div>
      </InsetCard>
    </div>
  );
};

export default WorkspaceView;
