import React, { memo, useCallback, useMemo, useRef, useState } from 'react';
import { WorkspaceGraphView } from './WorkspaceGraphView';
import { WorkspaceDataView } from './WorkspaceDataView';
import { WorkspaceControls } from './WorkspaceControls';

/**
 * Improved WorkspaceView with vertical layout showing both graph and data views
 * This replaces the tab-based layout with stacked views
 */
const WorkspaceView: React.FC = memo(() => {
  // Collapsing is managed by App.tsx (entire right panel). This view is always expanded.
  // Resizable split between Graph (top) and Data (bottom)
  const containerRef = useRef<HTMLDivElement>(null);
  const [split, setSplit] = useState<number>(50); // percentage for top panel height
  const isDraggingRef = useRef(false);

  const onStartDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    // Add listeners on window to capture outside the bar
    const onMove = (ev: MouseEvent) => {
      if (!isDraggingRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const offsetY = ev.clientY - rect.top;
      const pct = Math.min(80, Math.max(20, (offsetY / rect.height) * 100));
      setSplit(pct);
    };
    const onUp = () => {
      isDraggingRef.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  const topStyle = useMemo(() => ({ height: `${split}%` }), [split]);
  const bottomStyle = useMemo(() => ({ height: `${100 - split}%` }), [split]);

  return (
    <div className="flex flex-col h-full bg-white" ref={containerRef}>
      {/* Header with controls */}
      <div className="flex-shrink-0 border-b border-gray-200 flex items-center justify-between">
        <WorkspaceControls />
      </div>

      <>
          {/* Graph View - Top resizable section */}
          <div className="border-b border-gray-200 flex flex-col min-h-[120px]" style={topStyle}>
            <div className="p-2 bg-gray-50 border-b border-gray-200 flex-shrink-0">
              <h3 className="text-sm font-medium text-gray-700">Graph View</h3>
            </div>
            <div className="flex-1 min-h-0">
              <WorkspaceGraphView />
            </div>
          </div>

          {/* Drag handle */}
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

          {/* Data View - Bottom resizable section */}
          <div className="flex flex-col min-h-[120px]" style={bottomStyle}>
            <div className="p-2 bg-gray-50 border-b border-gray-200 flex-shrink-0">
              <h3 className="text-sm font-medium text-gray-700">Data View</h3>
            </div>
            <div className="flex-1 min-h-0">
              <WorkspaceDataView />
            </div>
          </div>
      </>
    </div>
  );
});

WorkspaceView.displayName = 'WorkspaceView';

export default WorkspaceView;
