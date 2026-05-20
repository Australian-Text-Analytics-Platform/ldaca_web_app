import { useState } from 'react';
import type { ReactNode } from 'react';
import '@xyflow/react/dist/style.css';

import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  type NodeTypes,
} from '@xyflow/react';
import { Loader2, Network } from 'lucide-react';

import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

import { useWorkspaceGraph } from '../hooks/useWorkspaceGraph';
import { TokensCacheRepairBanner } from './TokensCacheRepairBanner';

export interface WorkspaceGraphFeatureProps {
  fallback?: ReactNode;
}

const OverviewToggle = ({
  active,
  onToggle,
}: {
  active: boolean;
  onToggle: () => void;
}) => (
  <button
    type="button"
    className="react-flow__controls-button"
    onClick={onToggle}
    title={active ? 'Hide overview' : 'Show overview'}
  >
    {active ? '▣' : '□'}
  </button>
);

const DeselectButton = ({
  disabled,
  onClear,
}: {
  disabled: boolean;
  onClear: () => void;
}) => (
  <button
    type="button"
    className="react-flow__controls-button"
    onClick={onClear}
    disabled={disabled}
    title="Deselect all selected data blocks"
    style={{ opacity: disabled ? 0.5 : 1 }}
  >
    ⊘
  </button>
);

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
    // ``min-w-0`` lets this container shrink below its content's
    // intrinsic min-width when the parent flex column is narrow —
    // without it, ReactFlow's children would refuse to shrink past
    // their natural width and push the workspace panel off-viewport.
    <div className="relative h-full w-full min-w-0">
      {/* Banner is an absolute overlay so it doesn't shrink the graph
        canvas and stays bounded width. Insets are tight (left-4 right-4)
        so the banner can fit even when the workspace panel is narrow;
        on wider panels the inner ``max-w-xl`` caps it at a readable
        width and the flex-justify-center keeps it centred. */}
      <div className="absolute top-4 left-4 right-4 z-20 pointer-events-none flex justify-center">
        <div className="pointer-events-auto w-full max-w-xl">
          <TokensCacheRepairBanner />
        </div>
      </div>
      <GraphSelectionOverlay selected={graph.selectedCount} total={graph.totalNodes} />

      <ReactFlow
        nodes={graph.nodes}
        edges={graph.edges}
        nodeTypes={graph.nodeTypes as unknown as NodeTypes}
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
          <OverviewToggle active={showOverview} onToggle={() => setShowOverview((value) => !value)} />
          <DeselectButton
            disabled={!graph.canClearSelection}
            onClear={() => graph.clearSelection?.()}
          />
        </Controls>
        {showOverview && (
          <MiniMap position="bottom-right" nodeColor="#e2e8f0" maskColor="rgba(255, 255, 255, 0.8)" />
        )}
      </ReactFlow>
    </div>
  );
}
