import React, { memo, useCallback, useMemo, useEffect, useRef, useState } from 'react';
import dagre from 'dagre';
import {
  ReactFlow,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  ConnectionLineType,
  NodeMouseHandler,
  Node,
  Edge,
  Connection,
  BezierEdge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useWorkspace } from '../hooks/useWorkspace';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../lib/queryKeys';
import { GraphLoadingSkeleton, EmptyState } from './LoadingStates';
import CustomNode from './CustomNode';

// Static registrations to avoid re-creation
const nodeTypes = { customNode: CustomNode } as const;
const edgeTypes = { bezier: BezierEdge } as const;

// Dagre-based auto-layout (left-to-right) respecting edges and grouping branches
const computeDagreLayout = (
  nodes: Array<{ id: string }>,
  edges: Array<{ source: string; target: string }>,
  opts: { rankdir?: 'LR' | 'TB'; ranksep?: number; nodesep?: number } = {}
) => {
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: opts.rankdir ?? 'LR',
    ranksep: opts.ranksep ?? 120,
    nodesep: opts.nodesep ?? 80,
    ranker: 'longest-path',
  });
  g.setDefaultEdgeLabel(() => ({}));

  // Estimate node dimensions for layout; React Flow will render precisely
  const DEFAULT_W = 320;
  const DEFAULT_H = 140;

  nodes.forEach((n) => g.setNode(n.id, { width: DEFAULT_W, height: DEFAULT_H }));
  edges.forEach((e) => g.setEdge(e.source, e.target));

  dagre.layout(g);

  const positions = new Map<string, { x: number; y: number }>();
  nodes.forEach((n) => {
    const p = g.node(n.id);
    if (p) {
      positions.set(n.id, {
        // Dagre returns centers; shift to top-left for React Flow
        x: p.x - DEFAULT_W / 2,
        y: p.y - DEFAULT_H / 2,
      });
    }
  });

  return positions;
};

/**
 * Separated graph view component focused only on ReactFlow rendering
 * This replaces the graph-related logic from the monolithic WorkspaceView
 */
export const WorkspaceGraphView: React.FC = memo(() => {
  // Lightweight runtime toggle for verbose graph logging
  const DEBUG_GRAPH = (typeof window !== 'undefined' && (window as any).__LDACA_DEBUG_GRAPH) ||
    (typeof window !== 'undefined' && localStorage.getItem('debugGraph') === '1');
  const dlog = useCallback((...args: any[]) => { if (DEBUG_GRAPH) console.log(...args); }, [DEBUG_GRAPH]);
  // Minimap hidden by default; user can toggle via custom control button
  const [showOverview, setShowOverview] = useState(false);
  const { workspaceGraph, isLoading, deleteNode, renameNode, toggleNodeSelection, convertToDocDataFrame, convertToDataFrame, convertToDocLazyFrame, convertToLazyFrame, resetDocumentColumn, currentWorkspaceId, selectedNodeIds, clearSelection } = useWorkspace();
  const queryClient = useQueryClient();
  
  // Track pending delete operations to prevent duplicates
  const pendingDeletes = useRef<Set<string>>(new Set());

  // Create stable callback functions to prevent recreation on every render
  const handleDelete = useCallback((nodeId: string) => {
    if (deleteNode && !pendingDeletes.current.has(nodeId)) {
      pendingDeletes.current.add(nodeId);
      deleteNode(nodeId).finally(() => {
        pendingDeletes.current.delete(nodeId);
      });
    }
  }, [deleteNode]);

  const handleRename = useCallback((nodeId: string, newName: string) => {
    if (renameNode) {
      renameNode(nodeId, newName);
    }
  }, [renameNode]);

  const handleConvertToDocDataFrame = useCallback((nodeId: string, documentColumn: string) => {
    if (convertToDocDataFrame) {
      convertToDocDataFrame(nodeId, documentColumn);
      if (currentWorkspaceId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.nodeData(currentWorkspaceId, nodeId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.nodeSchema(currentWorkspaceId, nodeId) });
      }
    }
  }, [convertToDocDataFrame, currentWorkspaceId, queryClient]);

  const handleConvertToDataFrame = useCallback((nodeId: string) => {
    if (convertToDataFrame) {
      convertToDataFrame(nodeId);
      if (currentWorkspaceId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.nodeData(currentWorkspaceId, nodeId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.nodeSchema(currentWorkspaceId, nodeId) });
      }
    }
  }, [convertToDataFrame, currentWorkspaceId, queryClient]);

  const handleConvertToDocLazyFrame = useCallback((nodeId: string, documentColumn: string) => {
    if (convertToDocLazyFrame) {
      convertToDocLazyFrame(nodeId, documentColumn);
      if (currentWorkspaceId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.nodeData(currentWorkspaceId, nodeId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.nodeSchema(currentWorkspaceId, nodeId) });
      }
    }
  }, [convertToDocLazyFrame, currentWorkspaceId, queryClient]);

  const handleConvertToLazyFrame = useCallback((nodeId: string) => {
    if (convertToLazyFrame) {
      convertToLazyFrame(nodeId);
      if (currentWorkspaceId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.nodeData(currentWorkspaceId, nodeId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.nodeSchema(currentWorkspaceId, nodeId) });
      }
    }
  }, [convertToLazyFrame, currentWorkspaceId, queryClient]);

  const handleResetDocument = useCallback((nodeId: string, documentColumn?: string) => {
    if (resetDocumentColumn) {
      resetDocumentColumn(nodeId, documentColumn);
      if (currentWorkspaceId) {
  queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.nodeData(currentWorkspaceId, nodeId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.nodeSchema(currentWorkspaceId, nodeId) });
      }
    }
  }, [resetDocumentColumn, currentWorkspaceId, queryClient]);

  // Transform and layout nodes horizontally using a simple DAG layout
  const initialNodes = useMemo(() => {
    if (!workspaceGraph || !workspaceGraph.nodes) {
      return [];
    }

    const positions = computeDagreLayout(
      (workspaceGraph.nodes || []).map((n: any) => ({ id: n.id })),
      (workspaceGraph.edges || []).map((e: any) => ({ source: e.source, target: e.target })),
      { rankdir: 'LR', ranksep: 140, nodesep: 100 }
    );

    return workspaceGraph.nodes.map((node: any, index: number) => {
      dlog('WorkspaceGraphView: Raw node data (condensed):', {
        id: node.id,
        nodeType: node.data?.nodeType,
        isLazy: node.data?.isLazy || node.data?.lazy,
        documentColumn: node.data?.documentColumn
      });
      
      // Extract shape information from backend data - backend returns shape directly as tuple
      const backendShape = node.data?.shape;
      let shape = [0, 0];
      if (backendShape && Array.isArray(backendShape) && backendShape.length === 2) {
        // Preserve null values for LazyFrames, don't convert to 0
        shape = [
          backendShape[0] !== undefined ? backendShape[0] : 0, 
          backendShape[1] !== undefined ? backendShape[1] : 0
        ];
      }
      
      // Better data type detection - backend sends it in nodeType field
  const dataType = node.data?.nodeType || node.data?.dataType || node.data?.type || node.type || 'unknown';
  dlog('WorkspaceGraphView: Resolved dataType:', node.id, dataType);
      
      const pos = positions.get(node.id) || { x: index * 320, y: 50 };
  return {
        id: node.id,
        // Use a true custom node type to avoid default node styling
        type: 'customNode',
        position: pos,
    data: {
          node: {
            node_id: node.id,
            name: node.data?.nodeName || node.data?.label || `Node ${index + 1}`,
            shape: shape,
            columns: node.data?.columns || [],
            preview: [], // TODO: Extract from node.data if available
            is_text_data: node.data?.dataType?.includes('Doc') || false,
            data_type: dataType,
      document_column: node.data?.documentColumn || null,
            column_schema: node.data?.schema ? 
              Object.fromEntries(node.data.schema.map((col: any) => [col.name, col.js_type])) : {},
            is_lazy: node.data?.isLazy || node.data?.lazy || false,
          },
          // Derive multi-select flag directly from single source of truth selection array
          isMultiSelected: (selectedNodeIds?.length || 0) > 1 && selectedNodeIds.includes(node.id),
          onDelete: handleDelete,
          onRename: handleRename,
          onConvertToDocDataFrame: handleConvertToDocDataFrame,
          onConvertToDataFrame: handleConvertToDataFrame,
          onConvertToDocLazyFrame: handleConvertToDocLazyFrame,
          onConvertToLazyFrame: handleConvertToLazyFrame,
          onResetDocument: handleResetDocument,
        },
        // Keep interaction flags minimal and disable edge connections
        hidden: false,
        draggable: true,
        selectable: true,
    selected: selectedNodeIds?.includes?.(node.id) ?? false,
        connectable: false,
      };
    });
  }, [workspaceGraph, handleDelete, handleRename, handleConvertToDocDataFrame, handleConvertToDataFrame, handleConvertToDocLazyFrame, handleConvertToLazyFrame, handleResetDocument, selectedNodeIds, dlog]);

  // Build edges with bezier style for smooth curves
  const initialEdges = useMemo(() => {
    if (!workspaceGraph || !workspaceGraph.edges) return [];
    return workspaceGraph.edges.map((e: any, idx: number) => ({
      id: e.id || `edge-${idx}`,
      source: e.source,
      target: e.target,
      type: 'bezier',
      animated: !!e.animated,
      label: e.label,
    }));
  }, [workspaceGraph]);
  
    // Use React Flow state hooks properly
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // Create stable string identifiers for comparison
  const currentNodeIds = nodes.map((n: Node) => n.id).join(',');
  const currentEdgeIds = edges.map((e: Edge) => `${e.source}-${e.target}`).join(',');
  const newNodeIds = workspaceGraph?.nodes?.map((n: any) => n.id).join(',') || '';
  const newEdgeIds = workspaceGraph?.edges?.map((e: any) => `${e.source}-${e.target}`).join(',') || '';

  // Also compute a lightweight signature that includes data_type and laziness so
  // in-place conversions (which keep the same IDs) still trigger an update
  const currentNodesSignature = nodes
    .map((n: any) => {
      const dt = n?.data?.node?.data_type ?? 'unknown';
      const lazy = n?.data?.node?.is_lazy ? '1' : '0';
      const docc = n?.data?.node?.document_column || '';
      const name = n?.data?.node?.name || '';
      return `${n.id}:${dt}:${lazy}:${docc}:${name}`;
    })
    .join(',');
  const newNodesSignature = (workspaceGraph?.nodes || [])
    .map((gn: any) => {
      const dt = gn?.data?.nodeType || gn?.data?.dataType || gn?.type || 'unknown';
      const lazy = (gn?.data?.isLazy || gn?.data?.lazy) ? '1' : '0';
      const docc = gn?.data?.documentColumn || '';
      const name = gn?.data?.nodeName || gn?.data?.label || '';
      return `${gn.id}:${dt}:${lazy}:${docc}:${name}`;
    })
    .join(',');
  
  const updateRafRef = useRef<number | null>(null);
  useEffect(() => {
    if (
      newNodeIds === currentNodeIds &&
      newEdgeIds === currentEdgeIds &&
      newNodesSignature === currentNodesSignature
    ) {
      return; // No meaningful change
    }
    // Debounce into next animation frame; coalesce rapid successive triggers
    if (updateRafRef.current) {
      cancelAnimationFrame(updateRafRef.current);
    }
    updateRafRef.current = requestAnimationFrame(() => {
      dlog('WorkspaceGraphView: Applying graph update', {
        nodeCount: initialNodes.length,
        edgeCount: initialEdges.length,
      });
      setNodes(initialNodes);
      setEdges(initialEdges);
    });
    return () => {
      if (updateRafRef.current) cancelAnimationFrame(updateRafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newNodeIds, newEdgeIds, newNodesSignature, currentNodesSignature]);

  // Removed edge-clearing safeguards so backend edges can render

  // Add effect to monitor actual React Flow state changes
  useEffect(() => {
    dlog('WorkspaceGraphView: React Flow state changed', {
      nodes: nodes.length,
      edges: edges.length,
    });
  }, [nodes, edges, dlog]);

  // Handle node selection
  const onNodeClick: NodeMouseHandler = useCallback((event: React.MouseEvent, node: Node) => {
    event.preventDefault();
    event.stopPropagation();
    if (node && node.id) {
      // Toggle selection without requiring Command/Ctrl
      toggleNodeSelection(node.id);
    }
  }, [toggleNodeSelection]);

  // Keep React Flow node 'selected' flags in sync with our store selection
  useEffect(() => {
    // Single Source of Truth: derive both selected and multi-selected flags here
    setNodes((ns) => ns.map((n: any) => ({
      ...n,
      selected: selectedNodeIds?.includes?.(n.id) ?? false,
      data: {
        ...n.data,
        isMultiSelected: (selectedNodeIds?.length || 0) > 1 && selectedNodeIds?.includes?.(n.id),
      }
    })) as any);
  }, [selectedNodeIds, setNodes]);

  // When selection is cleared (length 0) ensure any residual React Flow internal selection state is flushed.
  useEffect(() => {
    if (!selectedNodeIds || selectedNodeIds.length === 0) {
      setNodes((ns) => ns.map((n: any) => ({
        ...n,
        selected: false,
        data: { ...n.data, isMultiSelected: false }
      })) as any);
    }
  }, [selectedNodeIds, setNodes]);

  // Normalize selection changes coming from React Flow so pane clicks don't clear highlights
  const handleNodesChange = useCallback((changes: any) => {
    const normalized = (changes || []).map((c: any) => {
      if (c.type === 'select') {
        // Force selection to reflect our store, ignoring pane-clearing behavior
        return { ...c, selected: selectedNodeIds?.includes?.(c.id) ?? false };
      }
      return c;
    });
    onNodesChange(normalized);
  }, [onNodesChange, selectedNodeIds]);

  if (isLoading.graph) {
    return <GraphLoadingSkeleton />;
  }

  if (!workspaceGraph || initialNodes.length === 0) {
    return (
      <EmptyState
        title="No nodes in workspace"
        description="Add some data to your workspace to see the graph visualization"
        icon={
          <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        }
      />
    );
  }

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
  nodeTypes={nodeTypes as any}
  edgeTypes={edgeTypes as any}
  onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onPaneClick={() => {
          // React Flow clears selection on pane click; immediately restore it from our store
          setNodes((ns) => ns.map((n) => ({ ...n, selected: selectedNodeIds?.includes?.(n.id) ?? false })) as any);
        }}
  connectionLineType={ConnectionLineType.Bezier}
        defaultEdgeOptions={{ type: 'bezier' }}
        // One-time fit handled in onInit to avoid repeated resize-triggered layout loops
        onInit={(instance) => {
          try {
            instance.fitView({ padding: 0.2, includeHiddenNodes: false });
          } catch (e) {
            dlog('WorkspaceGraphView: fitView error (ignored)', e);
          }
        }}
        attributionPosition="bottom-left"
        className="bg-gray-50"
        style={{ width: '100%', height: '100%' }}
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
        // Explicitly disable ALL edge-related functionality
        connectOnClick={false}
        nodesDraggable={true}
        nodesConnectable={false}
        elementsSelectable={true}
        // Prevent any edge creation via handles, but don't clear existing edges
        onConnect={(connection: Connection) => {
          dlog('WorkspaceGraphView: onConnect blocked - manual edges disabled', connection);
        }}
        onConnectStart={(event, params) => {
          dlog('WorkspaceGraphView: onConnectStart blocked', params);
        }}
        onConnectEnd={(event) => {
          dlog('WorkspaceGraphView: onConnectEnd blocked');
        }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
        <Controls position="top-right">
          {/* Overview toggle */}
          <button
            type="button"
            className="react-flow__controls-button"
            onClick={() => setShowOverview(v => !v)}
            title={showOverview ? 'Hide overview' : 'Show overview'}
          >
            {showOverview ? '▣' : '□'}
          </button>
          {/* Deselect all */}
          <button
            type="button"
            className="react-flow__controls-button"
            onClick={() => clearSelection?.()}
            disabled={!selectedNodeIds || selectedNodeIds.length === 0}
            title="Deselect all selected nodes"
            style={{ opacity: !selectedNodeIds || selectedNodeIds.length === 0 ? 0.5 : 1 }}
          >
            ⊘
          </button>
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
});

WorkspaceGraphView.displayName = 'WorkspaceGraphView';
