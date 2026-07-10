import { useState } from 'react';
import type { ReactNode } from 'react';
import '@xyflow/react/dist/style.css';

import { Background, BackgroundVariant, Controls, MiniMap, ReactFlow } from '@xyflow/react';
import { CircleOff, Loader2, Map, Network } from 'lucide-react';

import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

import { useWorkspaceGraph } from '../hooks/useWorkspaceGraph';

export interface WorkspaceGraphFeatureProps {
  fallback?: ReactNode;
}

/**
 * Control button that toggles the React Flow minimap overview.
 * Rendered within `WorkspaceGraphFeature` because graph controls need a compact overview toggle.
 * Flow: receive the overview state, choose the button title/icon opacity, and invoke the supplied toggle handler from React Flow controls.
 */
const OverviewToggle = ({ active, onToggle }: { active: boolean; onToggle: () => void }) => (
  <button
    type="button"
    className="react-flow__controls-button"
    onClick={onToggle}
    title={active ? 'Hide overview' : 'Show overview'}
  >
    <Map className={active ? 'h-4 w-4' : 'h-4 w-4 opacity-60'} aria-hidden="true" />
  </button>
);

/**
 * Control button that clears selected workspace nodes.
 * Rendered within `WorkspaceGraphFeature` because multi-select graph sessions need a one-click clear action.
 * Flow: receive disabled state and clear callback, render a React Flow control button, and block the clear action when no selection can be cleared.
 */
const DeselectButton = ({ disabled, onClear }: { disabled: boolean; onClear: () => void }) => (
  <button
    type="button"
    className="react-flow__controls-button"
    onClick={onClear}
    disabled={disabled}
    title="Deselect all selected data blocks"
    style={{ opacity: disabled ? 0.5 : 1 }}
  >
    <CircleOff className="h-4 w-4" aria-hidden="true" />
  </button>
);

/**
 * Floating selection count shown over the graph canvas.
 * Rendered within `WorkspaceGraphFeature` because graph users need visible multi-selection feedback.
 * Flow: skip the overlay when no nodes exist, otherwise render selected and total counts over the graph canvas.
 */
const GraphSelectionOverlay = ({ selected, total }: { selected: number; total: number }) => {
  if (!total) {
    return null;
  }
  return (
    <div className="absolute top-4 left-4 z-10 rounded border border-border bg-white/90 px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm">
      {selected}/{total} selected
    </div>
  );
};

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
 * Flow: render a centered card with the graph icon, title, and Data Loader prompt when no workspace graph can be displayed.
 */
const GraphEmptyState = () => (
  <Card className="mx-auto mt-12 max-w-lg text-center">
    <CardHeader className="flex flex-col items-center space-y-3">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Network className="h-6 w-6" />
      </div>
      <CardTitle>No workspace loaded</CardTitle>
      <CardDescription>Open or create a workspace in Data Loader to see the graph.</CardDescription>
    </CardHeader>
  </Card>
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
      <GraphSelectionOverlay selected={graph.selectedCount} total={graph.totalNodes} />

      <ReactFlow
        nodes={graph.nodes}
        edges={graph.edges}
        nodeTypes={graph.nodeTypes}
        onNodesChange={graph.handleNodesChange}
        onEdgesChange={graph.handleEdgesChange}
        onNodeClick={graph.handleNodeClick}
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
        <Controls position="top-right">
          <OverviewToggle
            active={showOverview}
            onToggle={() => {
              setShowOverview((value) => !value);
            }}
          />
          <DeselectButton
            disabled={!graph.canClearSelection}
            onClear={() => graph.clearSelection?.()}
          />
        </Controls>
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
