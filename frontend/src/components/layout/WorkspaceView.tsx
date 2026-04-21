import React, { useRef, useState } from 'react';
import { WorkspaceGraphView } from './WorkspaceGraphView';
import { WorkspaceDataView } from './WorkspaceDataView';
import { WorkspaceControls } from './WorkspaceControls';

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

  const onStartDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!containerRef.current) return;
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
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div className="flex flex-col h-full bg-white" ref={containerRef}>
      <div ref={topRef} className="border-b border-border flex flex-col min-h-[120px]" style={{ height: `${split}%` }}>
        <div className="p-2 bg-muted border-b border-border flex-shrink-0">
          <WorkspaceControls />
        </div>
        <div className="flex-1 min-h-0">
          <WorkspaceGraphView />
        </div>
      </div>

      <div
        className="h-2 bg-gray-100 hover:bg-gray-200 cursor-row-resize relative group"
        onMouseDown={onStartDrag}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize graph and data panels"
      >
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="h-0.5 w-16 bg-gray-300 rounded group-hover:bg-gray-400" />
        </div>
      </div>

      <div ref={bottomRef} className="flex flex-col min-h-[120px]" style={{ height: `${100 - split}%` }}>
        <div className="flex-1 min-h-0">
          <WorkspaceDataView />
        </div>
      </div>
    </div>
  );
};

export default WorkspaceView;
