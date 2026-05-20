import React, { useRef } from 'react';
import { WorkspaceGraphView } from './WorkspaceGraphView';
import { WorkspaceDataView } from './WorkspaceDataView';
import { WorkspaceControls } from './WorkspaceControls';
import { InsetCard } from './InsetCard';
import { useResizableSplit } from '@/hooks/useResizableSplit';

/**
 * Stacked workspace view: graph on top, data table on bottom, with a
 * drag-to-resize separator. The graph view mounts React Flow and the
 * data view mounts a TanStack table, so we use the DOM-imperative mode
 * of useResizableSplit — pane heights are written via refs during the
 * drag and only committed to React state on pointerUp, keeping the
 * heavy children off the per-frame render path.
 */
const WorkspaceView: React.FC = () => {
  const topRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const { containerRef, value: ratio, isDragging, splitterProps } = useResizableSplit({
    defaultValue: 0.5,
    min: 0.2,
    max: 0.8,
    persistKey: 'ldaca.layout.workspaceGraphRatio',
    onLiveUpdate: (next) => {
      if (topRef.current) topRef.current.style.height = `${next * 100}%`;
      if (bottomRef.current) bottomRef.current.style.height = `${(1 - next) * 100}%`;
    },
  });

  return (
    <div className="flex flex-col h-full bg-transparent" ref={containerRef}>
      <InsetCard
        ref={topRef}
        className="min-h-30 p-2 pb-1"
        style={{ height: `calc(${ratio * 100}% - 0.25rem)` }}
      >
        <div className="p-2 bg-muted border-b border-border shrink-0 min-w-0">
          <WorkspaceControls />
        </div>
        <div className="flex-1 min-h-0 min-w-0">
          <WorkspaceGraphView />
        </div>
      </InsetCard>

      <div
        className="h-2 shrink-0 cursor-row-resize relative group flex items-center justify-center"
        aria-label="Resize graph and data panels"
        {...splitterProps}
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
        style={{ height: `calc(${(1 - ratio) * 100}% - 0.25rem)` }}
      >
        <div className="flex-1 min-h-0 min-w-0">
          <WorkspaceDataView />
        </div>
      </InsetCard>
    </div>
  );
};

export default WorkspaceView;
