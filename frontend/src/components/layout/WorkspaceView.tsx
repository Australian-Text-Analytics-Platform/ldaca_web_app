import { useRef, useState } from 'react';
import { WorkspaceControls } from './WorkspaceControls';
import { InsetCard } from './InsetCard';
import { useResizableSplit } from '@/hooks/useResizableSplit';
import { WorkspaceDataTableFeature } from '@/features/workspace/data-view';
import { WorkspaceGraphFeature } from '@/features/workspace/graph-view';
import { WorkspaceListView } from './WorkspaceListView';
import { WorkspaceSchemaView } from './WorkspaceSchemaView';

/**
 * Stacked workspace view used by the main app shell: graph above, data table
 * below, with a drag separator. It uses `useResizableSplit` refs so React Flow
 * and TanStack Table panes avoid per-frame React rerenders during resizing.
 * Why: graph and table panes need resize feedback without rerendering expensive children on every pointer move.
 * Flow: connect split refs to graph/table panes, imperatively resize during drag, then render controls, graph, splitter, and data table.
 *
 * ``collapsed`` (from WorkspaceShell): when true, the panel is in its compact
 * mode — the graph becomes a node list view and the data table becomes a
 * schema-only view. ``onToggleCollapse`` toggles that mode (passed to the
 * header). The chosen schema node is held locally so the list view's magnifier
 * drives the schema pane below it.
 */
function WorkspaceView({
  collapsed = false,
  onToggleCollapse,
}: { collapsed?: boolean; onToggleCollapse?: () => void } = {}) {
  const [schemaNodeId, setSchemaNodeId] = useState<string | null>(null);
  const topRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const {
    containerRef,
    value: ratio,
    isDragging,
    splitterProps,
  } = useResizableSplit({
    defaultValue: 0.5,
    min: 0.2,
    max: 0.8,
    persistKey: 'ldaca.layout.workspaceGraphRatio',
    /**
     * Applies drag feedback directly to panes so graph/table consumers avoid render churn mid-resize.
     * Why: callers need a focused rendering boundary for layout, accessibility, and state handoff.
     */
    onLiveUpdate: (next) => {
      if (topRef.current) topRef.current.style.height = `${String(next * 100)}%`;
      if (bottomRef.current) bottomRef.current.style.height = `${String((1 - next) * 100)}%`;
    },
  });

  return (
    <div className="flex flex-col h-full bg-transparent" ref={containerRef}>
      <InsetCard
        ref={topRef}
        className="min-h-30 p-2 pb-1"
        style={{ height: `calc(${String(ratio * 100)}% - 0.25rem)` }}
      >
        <div className="p-2 bg-muted border-b border-border shrink-0">
          <WorkspaceControls collapsed={collapsed} onToggleCollapse={onToggleCollapse} />
        </div>
        <div className="flex-1 min-h-0">
          {collapsed ? (
            <WorkspaceListView onShowSchema={setSchemaNodeId} />
          ) : (
            <WorkspaceGraphFeature />
          )}
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
        style={{ height: `calc(${String((1 - ratio) * 100)}% - 0.25rem)` }}
      >
        <div className="flex-1 min-h-0">
          {collapsed ? (
            <WorkspaceSchemaView nodeId={schemaNodeId} />
          ) : (
            <WorkspaceDataTableFeature />
          )}
        </div>
      </InsetCard>
    </div>
  );
}

export default WorkspaceView;
