import type { ReactNode } from 'react';
import { useState } from 'react';
import '@xyflow/react/dist/style.css';

import {
  Background,
  BackgroundVariant,
  ControlButton,
  Controls,
  MiniMap,
  ReactFlow,
  useReactFlow,
  useStore,
} from '@xyflow/react';
import { CircleOff, Loader2, Map, Minus, Plus, Scan, Trash2 } from 'lucide-react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useWorkspaceActions } from '@/features/workspace/common/hooks/useWorkspaceActions';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import { useWorkspaceSelection } from '@/features/workspace/common/hooks/useWorkspaceSelection';
import { cn } from '@/lib/utils';

import { useWorkspaceGraph } from '../hooks/useWorkspaceGraph';

export interface WorkspaceGraphFeatureProps {
  fallback?: ReactNode;
}

interface WorkspaceGraphControlButtonProps {
  accessibleLabel: string;
  label: string;
  children: ReactNode;
  disabled?: boolean;
  active?: boolean;
  destructive?: boolean;
  onClick: () => void;
}

/**
 * Expandable action used in the Workspace Graph View control rail.
 * Flow: keep the icon visible in the collapsed rail and reveal its text label on rail hover or focus.
 */
function WorkspaceGraphControlButton({
  accessibleLabel,
  label,
  children,
  disabled,
  active,
  destructive,
  onClick,
}: WorkspaceGraphControlButtonProps) {
  return (
    <ControlButton
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={accessibleLabel}
      className={cn(
        '!h-10 !w-10 !min-w-10 !justify-start !gap-3 !overflow-hidden !px-3',
        'transition-[width,background-color,color] duration-150 ease-out',
        'group-hover/workspace-controls:!w-40 group-focus-within/workspace-controls:!w-40',
        'disabled:!bg-muted disabled:!text-muted-foreground disabled:opacity-50',
        active && '!bg-violet-100 !text-violet-700',
        destructive && !disabled && '!text-destructive hover:!bg-destructive/10',
      )}
    >
      <span className="flex size-4 shrink-0 items-center justify-center [&_svg]:!size-4 [&_svg]:!max-h-none [&_svg]:!max-w-none [&_svg]:!fill-none">
        {children}
      </span>
      <span
        aria-hidden="true"
        className="pointer-events-none whitespace-nowrap text-xs font-medium opacity-0 transition-opacity duration-100 group-hover/workspace-controls:opacity-100 group-focus-within/workspace-controls:opacity-100"
      >
        {label}
      </span>
    </ControlButton>
  );
}

/**
 * Selection summary at the start of the graph control rail.
 * Flow: always show the compact selected/total value and reveal its descriptive label with the other controls.
 */
const GraphSelectionControl = ({ selected, total }: { selected: number; total: number }) => (
  <div
    role="status"
    aria-label={`${String(selected)} of ${String(total)} selected`}
    className="flex h-10 w-10 min-w-10 items-center justify-start gap-3 overflow-hidden px-2 text-xs font-semibold text-foreground tabular-nums transition-[width,padding] duration-150 ease-out group-hover/workspace-controls:w-40 group-hover/workspace-controls:px-3 group-focus-within/workspace-controls:w-40 group-focus-within/workspace-controls:px-3"
  >
    <span className="shrink-0">
      {selected}/{total}
    </span>
    <span
      aria-hidden="true"
      className="pointer-events-none whitespace-nowrap font-medium opacity-0 transition-opacity duration-100 group-hover/workspace-controls:opacity-100 group-focus-within/workspace-controls:opacity-100"
    >
      selected
    </span>
  </div>
);

/**
 * Batch-delete action and confirmation owned by the graph where selection is made.
 * Flow: resolve the selected Data Blocks, confirm their names, settle every deletion, then clear graph selection.
 */
function WorkspaceGraphDeleteControl() {
  const { workspaceGraph } = useWorkspaceData();
  const { deleteNode, clearSelection } = useWorkspaceActions();
  const { selectedNodeIds } = useWorkspaceSelection();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const selectedCount = selectedNodeIds.length;
  const canDelete = selectedCount > 0;

  const selectedForDelete = (() => {
    if (!workspaceGraph || !canDelete) return [];
    const selectedIds = new Set(selectedNodeIds);
    return workspaceGraph.nodes
      .filter((node) => selectedIds.has(node.id))
      .map((node) => ({
        id: node.id,
        name: typeof node.name === 'string' && node.name.trim() ? node.name : node.id,
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  })();

  const handleDelete = async () => {
    if (!canDelete || isDeleting) return;
    setIsDeleting(true);
    try {
      await Promise.allSettled(selectedForDelete.map((item) => deleteNode(item.id)));
      clearSelection();
      setConfirmOpen(false);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <WorkspaceGraphControlButton
        accessibleLabel={`Delete (${String(selectedCount)})`}
        label={`Delete (${String(selectedCount)})`}
        disabled={!canDelete || isDeleting}
        destructive
        onClick={() => {
          setConfirmOpen(true);
        }}
      >
        <Trash2 aria-hidden="true" />
      </WorkspaceGraphControlButton>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selectedForDelete.length} data block
              {selectedForDelete.length === 1 ? '' : 's'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. The following data blocks will be removed:
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="max-h-60 overflow-y-auto rounded border bg-muted/40 p-2 text-sm">
            {selectedForDelete.map((item) => (
              <li key={item.id}>{item.name}</li>
            ))}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <Button asChild variant="destructive" disabled={isDeleting || !canDelete}>
              <AlertDialogAction
                onClick={(event) => {
                  event.preventDefault();
                  void handleDelete();
                }}
                disabled={isDeleting || !canDelete}
              >
                {isDeleting ? 'Deleting…' : `Delete ${String(selectedForDelete.length)}`}
              </AlertDialogAction>
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

interface WorkspaceGraphControlsProps {
  selected: number;
  total: number;
  canClearSelection: boolean;
  showOverview: boolean;
  onClearSelection: () => void;
  onToggleOverview: () => void;
}

/**
 * Upper-left graph rail containing viewport, overview, selection, and destructive actions.
 * Flow: call React Flow's viewport APIs through explicit expandable controls so every icon and label shares one layout.
 */
function WorkspaceGraphControls({
  selected,
  total,
  canClearSelection,
  showOverview,
  onClearSelection,
  onToggleOverview,
}: WorkspaceGraphControlsProps) {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const minZoomReached = useStore((state) => state.transform[2] <= state.minZoom);
  const maxZoomReached = useStore((state) => state.transform[2] >= state.maxZoom);

  return (
    <Controls
      orientation="vertical"
      position="top-left"
      showZoom={false}
      showFitView={false}
      showInteractive={false}
      className="group/workspace-controls overflow-hidden rounded-md border border-border bg-background shadow-md"
      style={{ zIndex: 20 }}
      aria-label="Workspace graph controls"
    >
      <GraphSelectionControl selected={selected} total={total} />
      <WorkspaceGraphControlButton
        accessibleLabel="Zoom in"
        label="Zoom in"
        disabled={maxZoomReached}
        onClick={() => {
          void zoomIn();
        }}
      >
        <Plus aria-hidden="true" />
      </WorkspaceGraphControlButton>
      <WorkspaceGraphControlButton
        accessibleLabel="Zoom out"
        label="Zoom out"
        disabled={minZoomReached}
        onClick={() => {
          void zoomOut();
        }}
      >
        <Minus aria-hidden="true" />
      </WorkspaceGraphControlButton>
      <WorkspaceGraphControlButton
        accessibleLabel="Fit view"
        label="Fit view"
        onClick={() => {
          void fitView({ padding: 0.2, includeHiddenNodes: false });
        }}
      >
        <Scan aria-hidden="true" />
      </WorkspaceGraphControlButton>
      <WorkspaceGraphControlButton
        accessibleLabel={showOverview ? 'Hide overview' : 'Show overview'}
        label="Overview"
        active={showOverview}
        onClick={onToggleOverview}
      >
        <Map aria-hidden="true" />
      </WorkspaceGraphControlButton>
      <WorkspaceGraphControlButton
        accessibleLabel="Clear selection"
        label="Clear selection"
        disabled={!canClearSelection}
        onClick={onClearSelection}
      >
        <CircleOff aria-hidden="true" />
      </WorkspaceGraphControlButton>
      <WorkspaceGraphDeleteControl />
    </Controls>
  );
}

/**
 * Placeholder shown while the workspace graph query is loading.
 * Rendered within `WorkspaceGraphFeature` because graph loading needs a canvas-shaped skeleton.
 * Flow: render graph-card skeleton blocks first, then show a spinner label so the loading state preserves the canvas footprint.
 */
const GraphLoadingState = () => (
  <div className="flex h-full items-center justify-center bg-muted/20">
    <div className="flex flex-col items-center gap-4">
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-24 w-36 rounded-lg" />
        <Skeleton className="h-24 w-36 rounded-lg" />
        <Skeleton className="h-24 w-24 rounded-lg" />
        <Skeleton className="h-24 w-48 rounded-lg" />
      </div>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Loading workspace graph…</span>
      </div>
    </div>
  </div>
);

/**
 * Empty state shown before a workspace graph is available.
 * Rendered within `WorkspaceGraphFeature` because the graph feature needs an idle state before workspace data exists.
 * Flow: render a centered title and Data Loader prompt directly on the graph surface when no workspace graph can be displayed.
 */
const GraphEmptyState = () => (
  <div className="flex h-full items-center justify-center p-6 text-center">
    <div>
      <h3 className="text-sm font-semibold text-foreground">No workspace loaded</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Open or create a workspace in Data Loader to see the graph.
      </p>
    </div>
  </div>
);

/**
 * Renders the interactive workspace graph and its React Flow controls.
 * Rendered by `WorkspaceView`; `useWorkspaceGraph` supplies its React Flow model.
 * Flow: read the graph view model, branch to loading or empty fallback states, then wire nodes, edges, handlers, controls, and optional minimap into React Flow.
 */
export function WorkspaceGraphFeature({ fallback }: WorkspaceGraphFeatureProps) {
  const [showOverview, setShowOverview] = useState(false);
  const graph = useWorkspaceGraph();

  if (graph.isGraphLoading) {
    return <GraphLoadingState />;
  }

  if (graph.showEmptyState) {
    return <>{fallback ?? <GraphEmptyState />}</>;
  }

  return (
    <div className="relative h-full w-full">
      <ReactFlow
        nodes={graph.nodes}
        edges={graph.edges}
        nodeTypes={graph.nodeTypes}
        onNodesChange={graph.handleNodesChange}
        onEdgesChange={graph.handleEdgesChange}
        onNodeClick={graph.handleNodeClick}
        onNodeDoubleClick={graph.handleNodeDoubleClick}
        onPaneClick={graph.handlePaneClick}
        connectionLineType={graph.connectionLineType}
        defaultEdgeOptions={graph.defaultEdgeOptions}
        onInit={graph.handleInit}
        attributionPosition="bottom-left"
        className="bg-gray-50"
        style={{ width: '100%', height: '100%' }}
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
        minZoom={0.05}
        maxZoom={4}
        connectOnClick={false}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable
        onConnect={graph.handleConnect}
        onConnectStart={graph.handleConnectStart}
        onConnectEnd={graph.handleConnectEnd}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
        <WorkspaceGraphControls
          selected={graph.selectedCount}
          total={graph.totalNodes}
          canClearSelection={graph.canClearSelection}
          showOverview={showOverview}
          onClearSelection={() => graph.clearSelection?.()}
          onToggleOverview={() => {
            setShowOverview((value) => !value);
          }}
        />
        {showOverview && (
          <MiniMap
            position="bottom-right"
            nodeColor="#e2e8f0"
            maskColor="rgba(255, 255, 255, 0.8)"
          />
        )}
      </ReactFlow>
    </div>
  );
}
