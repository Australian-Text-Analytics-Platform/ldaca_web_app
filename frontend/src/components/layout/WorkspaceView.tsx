import { useRef } from 'react';
import { PanelRightOpen } from 'lucide-react';
import { WorkspaceControls } from './WorkspaceControls';
import { InsetCard } from './InsetCard';
import { useResizableSplit } from '@/hooks/useResizableSplit';
import { WorkspaceDataTableFeature } from '@/features/workspace/data-view';
import { WorkspaceGraphFeature } from '@/features/workspace/graph-view';
import { ResizeHandle } from './ResizeHandle';

/**
 * Stacked workspace view used by the main app shell: graph above, data table
 * below, with a drag separator. It uses `useResizableSplit` refs so React Flow
 * and TanStack Table panes avoid per-frame React rerenders during resizing.
 * Why: graph and table panes need resize feedback without rerendering expensive children on every pointer move.
 * Flow: connect split refs to graph/table panes, imperatively resize during drag, then render controls, graph, splitter, and data table.
 *
 * ``collapsed`` (from WorkspaceShell): when true, the panel is completely
 * collapsed into a slim vertical handle with an expand button on the right.
 * ``onToggleCollapse`` toggles that mode.
 */
function WorkspaceView({
  collapsed = false,
  onToggleCollapse,
}: {
  collapsed?: boolean;
  onToggleCollapse?: () => void;
} = {}) {
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
     */
    onLiveUpdate: (next) => {
      if (topRef.current) topRef.current.style.height = `${String(next * 100)}%`;
      if (bottomRef.current) bottomRef.current.style.height = `${String((1 - next) * 100)}%`;
    },
  });

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onToggleCollapse}
        className="absolute top-4.5 right-0 z-30 inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-l-full rounded-r-none border border-surface-border bg-surface text-foreground transition-all hover:bg-panel active:scale-95"
        aria-label="Expand right panel"
        title="Expand right panel"
      >
        <PanelRightOpen className="h-4 w-4" />
      </button>
    );
  }

  return (
    <div className="flex flex-col h-full bg-transparent" ref={containerRef}>
      <InsetCard
        ref={topRef}
        className="min-h-30 p-2 pt-0 pb-0 pl-0 max-md:pl-2 @max-[639px]/workspace-shell:pl-2"
        style={{ height: `calc(${String(ratio * 100)}% - 0.125rem)` }}
      >
        <div className="p-2 bg-panel border-b border-surface-border shrink-0">
          <WorkspaceControls onToggleCollapse={onToggleCollapse} />
        </div>
        <div className="flex-1 min-h-0">
          <WorkspaceGraphFeature />
        </div>
      </InsetCard>

      <ResizeHandle
        orientation="horizontal"
        isDragging={isDragging}
        className="-my-0.5 mr-2"
        aria-label="Resize graph and data panels"
        {...splitterProps}
      />

      <InsetCard
        ref={bottomRef}
        className="min-h-30 p-2 pt-0 pl-0 max-md:pl-2 @max-[639px]/workspace-shell:pl-2"
        style={{ height: `calc(${String((1 - ratio) * 100)}% - 0.125rem)` }}
      >
        <div className="flex-1 min-h-0">
          <WorkspaceDataTableFeature />
        </div>
      </InsetCard>
    </div>
  );
}

export default WorkspaceView;
