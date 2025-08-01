import React, { memo, useCallback, useMemo, useEffect, useRef } from 'react';
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
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useWorkspace } from '../hooks/useWorkspace';
import { GraphLoadingSkeleton, EmptyState } from './LoadingStates';
import CustomNode from './CustomNode';

// Move nodeTypes outside component to prevent recreation
const nodeTypes = {
  customNode: CustomNode,
  default: CustomNode, // Fallback
} as const;

/**
 * Separated graph view component focused only on ReactFlow rendering
 * This replaces the graph-related logic from the monolithic WorkspaceView
 */
export const WorkspaceGraphView: React.FC = memo(() => {
  const { workspaceGraph, isLoading, deleteNode, renameNode, selectNode, toggleNodeSelection } = useWorkspace();
  
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
    console.log('Convert to DocDataFrame:', nodeId, documentColumn);
    // TODO: Implement conversion functionality
  }, []);

  const handleConvertToDataFrame = useCallback((nodeId: string) => {
    console.log('Convert to DataFrame:', nodeId);
    // TODO: Implement conversion functionality
  }, []);

  // Transform and layout nodes horizontally
  const initialNodes = useMemo(() => {
    if (!workspaceGraph || !workspaceGraph.nodes) {
      return [];
    }

    return workspaceGraph.nodes.map((node: any, index: number) => {
      // Debug: Log the raw node data to understand the structure
      console.log('WorkspaceGraphView: Raw node data:', node);
      console.log('WorkspaceGraphView: node.data:', node.data);
      console.log('WorkspaceGraphView: node.data.dataType:', node.data?.dataType);
      console.log('WorkspaceGraphView: node.data.type:', node.data?.type);
      
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
      console.log('WorkspaceGraphView: Final dataType:', dataType);
      
      return {
        id: node.id,
        type: 'default', // Use 'default' instead of 'customNode'
        position: { 
          x: index * 320, // Slightly wider spacing
          y: 50 // Move up a bit
        },
        data: {
          node: {
            node_id: node.id,
            name: node.data?.nodeName || node.data?.label || `Node ${index + 1}`,
            shape: shape,
            columns: node.data?.columns || [],
            preview: [], // TODO: Extract from node.data if available
            is_text_data: node.data?.dataType?.includes('Doc') || false,
            data_type: dataType,
            column_schema: node.data?.schema ? 
              Object.fromEntries(node.data.schema.map((col: any) => [col.name, col.js_type])) : {},
            is_lazy: node.data?.isLazy || node.data?.lazy || false,
          },
          onDelete: handleDelete,
          onRename: handleRename,
          onConvertToDocDataFrame: handleConvertToDocDataFrame,
          onConvertToDataFrame: handleConvertToDataFrame,
        },
        // Ensure visibility with explicit styles and DISABLE ALL CONNECTION CAPABILITIES
        hidden: false,
        draggable: true,
        selectable: true,
        connectable: false, // Prevent this node from being connectable
        sourcePosition: undefined, // Remove source position to prevent connections
        targetPosition: undefined, // Remove target position to prevent connections
        style: {
          opacity: 1,
          visibility: 'visible',
          zIndex: 1,
        },
        width: 256, // Explicit width
        height: 120, // Explicit height
      };
    });
  }, [workspaceGraph, handleDelete, handleRename, handleConvertToDocDataFrame, handleConvertToDataFrame]);

  // EDGES DISABLED: Force no edges to prevent self-loops and unwanted connections
  // const initialEdges = useMemo(() => { ... }, [workspaceGraph]);
  
    // Use React Flow state hooks properly
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // Create stable string identifiers for comparison
  const currentNodeIds = nodes.map((n: Node) => n.id).join(',');
  const currentEdgeIds = edges.map((e: Edge) => `${e.source}-${e.target}`).join(',');
  const newNodeIds = workspaceGraph?.nodes?.map((n: any) => n.id).join(',') || '';
  const newEdgeIds = workspaceGraph?.edges?.map((e: any) => `${e.source}-${e.target}`).join(',') || '';
  
  useEffect(() => {
    // Only update if the data has actually changed
    if (newNodeIds !== currentNodeIds || newEdgeIds !== currentEdgeIds) {
      console.log('WorkspaceGraphView: Updating React Flow with nodes:', initialNodes.length);
      console.log('WorkspaceGraphView: FORCING edges to empty array');
      console.log('WorkspaceGraphView: Current React Flow nodes before update:', nodes);
      console.log('WorkspaceGraphView: Current React Flow edges before update:', edges);
      console.log('WorkspaceGraphView: Raw backend edges data:', workspaceGraph?.edges);
      if (initialNodes[0]) {
        console.log('WorkspaceGraphView: Node data sample:', initialNodes[0]);
      }
      setNodes(initialNodes);
      setEdges([]); // FORCE empty edges array
      
      console.log('WorkspaceGraphView: AFTER setEdges - edges should be empty');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newNodeIds, newEdgeIds]);

  // SAFEGUARD: Monitor edges state and clear any that appear
  useEffect(() => {
    if (edges.length > 0) {
      console.log('WorkspaceGraphView: SAFEGUARD - Detected unwanted edges, clearing:', edges);
      setEdges([]);
    }
  }, [edges, setEdges]);

  // ADDITIONAL SAFEGUARD: Force edges to empty on any React Flow state change
  useEffect(() => {
    const clearEdgesTimer = setInterval(() => {
      if (edges.length > 0) {
        console.log('WorkspaceGraphView: PERIODIC SAFEGUARD - Clearing edges:', edges);
        setEdges([]);
      }
    }, 100); // Check every 100ms

    return () => clearInterval(clearEdgesTimer);
  }, [edges, setEdges]);

  // Add effect to monitor actual React Flow state changes
  useEffect(() => {
    console.log('WorkspaceGraphView: React Flow nodes state changed:', nodes);
    console.log('WorkspaceGraphView: React Flow edges state changed:', edges);
  }, [nodes, edges]);

  // Handle node selection
  const onNodeClick: NodeMouseHandler = useCallback((event: React.MouseEvent, node: Node) => {
    if (node && node.id) {
      // Check for Command key (Mac) or Ctrl key (Windows/Linux) for multi-selection
      if (event.metaKey || event.ctrlKey) {
        toggleNodeSelection(node.id);
      } else {
        selectNode(node.id);
      }
    }
  }, [selectNode, toggleNodeSelection]);

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
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        connectionLineType={ConnectionLineType.SmoothStep}
        fitView
        fitViewOptions={{ padding: 0.2, includeHiddenNodes: false }}
        attributionPosition="bottom-left"
        className="bg-gray-50"
        style={{ width: '100%', height: '100%' }}
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
        // Explicitly disable ALL edge-related functionality
        connectOnClick={false}
        nodesDraggable={true}
        nodesConnectable={false}
        elementsSelectable={true}
        // Prevent any edge creation via handles
        onConnect={(connection: Connection) => {
          console.log('WorkspaceGraphView: onConnect blocked - no edges should be created', connection);
          setEdges([]); // Force clear any edges
        }}
        onConnectStart={(event, params) => {
          console.log('WorkspaceGraphView: onConnectStart blocked', params);
          setEdges([]); // Force clear any edges
        }}
        onConnectEnd={(event) => {
          console.log('WorkspaceGraphView: onConnectEnd blocked');
          setEdges([]); // Force clear any edges
        }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
        <Controls position="top-right" />
        <MiniMap
          position="bottom-right"
          nodeColor="#e2e8f0"
          maskColor="rgba(255, 255, 255, 0.8)"
        />
      </ReactFlow>
    </div>
  );
});

WorkspaceGraphView.displayName = 'WorkspaceGraphView';
