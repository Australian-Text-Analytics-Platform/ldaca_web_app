import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import '@xyflow/react/dist/style.css';

import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  type NodeTypes,
  type ReactFlowInstance,
} from '@xyflow/react';
import { Loader2, Network } from 'lucide-react';

import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

import { useWorkspaceGraph } from '../hooks/useWorkspaceGraph';

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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<ReactFlowInstance | null>(null);
  // Track the previous container HEIGHT so we only auto-refit when the
  // height changes by enough to suggest a banner mount/unmount (~50px+).
  // Splitter drags and tiny px-level resizes fire ResizeObserver too —
  // re-fitting on every one of them would override the user's manual
  // pan/zoom from one drag to the next.
  const lastHeightRef = useRef<number | null>(null);

  // Re-fit on significant container resize. The banner above us toggles
  // ~150px of height; without this the graph stays at its prior fit and
  // ends up off-position when the banner mounts or the user dismisses
  // it. Skips small height changes so manual splitter drags / window
  // tweaks don't blow away the user's current view.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const SIGNIFICANT_PX = 50;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const next = entry.contentRect.height;
      const prev = lastHeightRef.current;
      lastHeightRef.current = next;
      if (prev == null) return; // first observation, just record
      if (Math.abs(next - prev) < SIGNIFICANT_PX) return;
      try {
        instanceRef.current?.fitView({ padding: 0.2, includeHiddenNodes: false });
      } catch {
        /* ReactFlow is between mounts; ignore */
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handleInitWithInstance = (instance: ReactFlowInstance) => {
    instanceRef.current = instance;
    graph.handleInit?.(instance);
  };

  if (graph.isGraphLoading) {
    return <GraphLoadingState />;
  }

  if (graph.showEmptyState) {
    return <>{fallback ?? <GraphEmptyState />}</>;
  }

  return (
    <div ref={containerRef} className="relative h-full w-full">
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
        onInit={handleInitWithInstance}
        attributionPosition="bottom-left"
        className="bg-gray-50"
        style={{ width: '100%', height: '100%' }}
        // `fitView` (with options) replaces our hand-rolled fitView in
        // handleInit. ReactFlow runs this AFTER its own layout settles —
        // it waits for nodes to report their measured dimensions before
        // computing the viewport, so the graph isn't wedged into the
        // pre-layout container size (which happens with manual fitView
        // when the banner above is mounting simultaneously).
        fitView
        fitViewOptions={{ padding: 0.2, includeHiddenNodes: false }}
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
