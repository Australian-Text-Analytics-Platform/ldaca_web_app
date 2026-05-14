import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  type Connection,
  ConnectionLineType,
  type Edge,
  type Node,
  type NodeChange,
  type NodeMouseHandler,
  type ReactFlowInstance,
  useEdgesState,
  useNodesState,
} from '@xyflow/react';

import CustomNode from '@/features/workspace/graph-view/components/CustomNode';
import type { GraphNode, GraphEdge } from '@/types/api';
import { useWorkspaceActions } from '@/features/workspace/common/hooks/useWorkspaceActions';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import { useWorkspaceSelection } from '@/features/workspace/common/hooks/useWorkspaceSelection';
import { useWorkspaceStatus } from '@/features/workspace/common/hooks/useWorkspaceStatus';
import { isGraphDebugEnabled } from '@/lib/debugFlags';
import { nodeVisualInfo } from '@/lib/nodeVisualState';
import { useNodeColorsStore } from '@/stores/nodeColorsStore';
import { useUIStore } from '@/stores';
import { computeDagreLayout } from '../services/graphLayout';

const EDGE_STROKE = '#0f172a';
const nodeTypes = { customNode: CustomNode } as const;

export interface WorkspaceGraphViewModel {
  nodes: Node[];
  edges: Edge[];
  nodeTypes: typeof nodeTypes;
  isGraphLoading: boolean;
  showEmptyState: boolean;
  selectedCount: number;
  totalNodes: number;
  canClearSelection: boolean;
  handleNodeClick: NodeMouseHandler;
  handleNodesChange: ReturnType<typeof useNodesState<Node>>[2];
  handleEdgesChange: ReturnType<typeof useEdgesState<Edge>>[2];
  handlePaneClick: () => void;
  handleConnect: (connection: Connection) => void;
  handleConnectStart: (event: MouseEvent | TouchEvent, params: { nodeId: string | null; handleId: string | null; handleType: string | null }) => void;
  handleConnectEnd: (event: MouseEvent | TouchEvent) => void;
  handleInit: (instance: ReactFlowInstance) => void;
  clearSelection: (() => void) | undefined;
  connectionLineType: ConnectionLineType;
  defaultEdgeOptions: {
    type: string;
    animated: boolean;
    style: {
      strokeDasharray: string;
      strokeWidth: number;
      stroke: string;
    };
  };
}

export const useWorkspaceGraph = (): WorkspaceGraphViewModel => {
  const { workspaceGraph } = useWorkspaceData();
  const { currentWorkspaceId } = useWorkspaceData();
  const { selectedNodeIds } = useWorkspaceSelection();
  const { isLoading } = useWorkspaceStatus();
  const {
    deleteNode,
    copyNode,
    renameNode,
    undoNode,
    redoNode,
    toggleNodeSelection,
    clearSelection,
  } = useWorkspaceActions();

  const DEBUG_GRAPH = isGraphDebugEnabled();
  const dlog = useCallback((...args: unknown[]) => {
    if (DEBUG_GRAPH) {
      console.debug(...args);
    }
  }, [DEBUG_GRAPH]);
  const handleDelete = useCallback(
    (nodeId: string) => {
      if (!nodeId || !deleteNode) {
        return;
      }
      deleteNode(nodeId);
    },
    [deleteNode]
  );

  const handleRename = useCallback(
    (nodeId: string, newName: string) => {
      if (!nodeId || !newName?.trim() || !renameNode) {
        return;
      }
      renameNode(nodeId, newName.trim());
    },
    [renameNode]
  );

  const handleCopy = useCallback(
    (nodeId: string) => {
      if (!nodeId || !copyNode) {
        return;
      }
      copyNode(nodeId);
    },
    [copyNode]
  );

  const handleUndo = useCallback(
    (nodeId: string) => {
      if (!nodeId || !undoNode) {
        return;
      }
      void undoNode(nodeId);
    },
    [undoNode]
  );

  const handleRedo = useCallback(
    (nodeId: string) => {
      if (!nodeId || !redoNode) {
        return;
      }
      void redoNode(nodeId);
    },
    [redoNode]
  );


  // Per-node visual state (active / focus / unselected + X/Y colour pair)
  // is computed here once per render so CustomNode is purely presentational
  // — it just renders what data carries. See the strategy doc for the
  // active/focus split rules.
  const assignedColors = useNodeColorsStore((state) => state.colors);
  const currentView = useUIStore((state) => state.currentView);

  const initialNodes = useMemo(() => {
    if (!workspaceGraph?.nodes) {
      return [];
    }

    const positions = computeDagreLayout(
      workspaceGraph.nodes.map((n: GraphNode) => ({ id: n.id })),
      (workspaceGraph.edges || []).map((edge: GraphEdge) => ({ source: edge.source, target: edge.target })),
      { rankdir: 'LR', ranksep: 140, nodesep: 100 }
    );

    return workspaceGraph.nodes.map((node: GraphNode, index: number) => {
      const columns = Array.isArray(node.columns)
        ? node.columns.map((column: unknown) => String(column))
        : [];

      const columnSchema =
        node.schema && typeof node.schema === 'object'
          ? Object.entries(node.schema as Record<string, unknown>).reduce<Record<string, string>>((acc, [key, value]) => {
              acc[key] = String(value);
              return acc;
            }, {})
          : {};

      const documentColumn = typeof node.document === 'string' && node.document.trim().length > 0
        ? node.document
        : null;

      dlog('WorkspaceGraphView: Raw node data (condensed):', {
        id: node.id,
        operation: node.operation,
        columns: columns.length,
      });

        const rawShape = Array.isArray((node as { shape?: unknown }).shape)
          ? ((node as { shape?: unknown[] }).shape as unknown[])
          : null;
        const parsedShape: [number | null, number | null] =
          rawShape && rawShape.length >= 2
            ? [
                typeof rawShape[0] === 'number' ? rawShape[0] : null,
                typeof rawShape[1] === 'number' ? rawShape[1] : null,
              ]
            : [null, null];

      const position = positions.get(node.id) || { x: index * 320, y: 50 };

      // The backend's ``frontend_node_info`` adds these two fields when the
      // node has any registered analytic derivations (Phase 2 / decision 7).
      // Pass them through to ``data.node`` so the CustomNode chip + the
      // "Manage tokens…" menu entry can render; without this, the mapper
      // silently drops derived metadata even though it's in the graph
      // payload.
      const rawDerivedColumns = (node as { derived_columns?: unknown }).derived_columns;
      const passthroughDerivedColumns = Array.isArray(rawDerivedColumns)
        ? rawDerivedColumns.filter((c): c is string => typeof c === 'string')
        : undefined;
      const rawDerived = (node as { derived?: unknown }).derived;
      const passthroughDerived =
        rawDerived && typeof rawDerived === 'object' && !Array.isArray(rawDerived)
          ? (rawDerived as Record<string, unknown>)
          : undefined;

      return {
        id: node.id,
        type: 'customNode',
        position,
        data: {
          node: {
            node_id: node.id,
            name: node.name || `Node ${index + 1}`,
            shape: parsedShape,
            columns,
            preview: [],
            is_text_data: Boolean(documentColumn),
            data_type: 'LazyFrame',
            can_undo: Boolean(node.can_undo),
            can_redo: Boolean(node.can_redo),
            document: documentColumn,
            document_column: documentColumn,
            column_schema: columnSchema,
            derived_columns: passthroughDerivedColumns,
            derived: passthroughDerived,
          },
          isMultiSelected:
            (selectedNodeIds?.length || 0) > 1 && Boolean(selectedNodeIds?.includes?.(node.id)),
          visualInfo: nodeVisualInfo(node.id, {
            selectedNodeIds: selectedNodeIds ?? [],
            currentView,
            assignedColors,
          }),
          onDelete: handleDelete,
          onRename: handleRename,
          onCopy: handleCopy,
          onUndo: handleUndo,
          onRedo: handleRedo,
        },
        hidden: false,
        selectable: true,
        selected: selectedNodeIds?.includes?.(node.id) ?? false,
        connectable: false,
      } as Node;
    });
  }, [workspaceGraph, selectedNodeIds, currentView, assignedColors, handleDelete, handleRename, handleCopy, handleUndo, handleRedo, dlog]);

  const initialEdges = useMemo(() => {
    if (!workspaceGraph?.edges) {
      return [];
    }
    return workspaceGraph.edges.map((edge: GraphEdge & { label?: string }, index: number) => ({
      id: `edge-${edge.source}-${edge.target}-${index}`,
      source: edge.source,
      target: edge.target,
      type: 'default',
      animated: true,
      label: edge.label,
      style: {
        strokeDasharray: '6 4',
        strokeWidth: 2.5,
        stroke: EDGE_STROKE,
      },
    }));
  }, [workspaceGraph]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialEdges);

  const currentNodeIds = nodes.map((node: Node) => node.id).join(',');
  const currentEdgeIds = edges.map((edge: Edge) => `${edge.source}-${edge.target}`).join(',');
  const newNodeIds = initialNodes.map((node: Node) => node.id).join(',');
  const newEdgeIds = initialEdges.map((edge: Edge) => `${edge.source}-${edge.target}`).join(',');

  const currentNodesSignature = nodes
    .map((node: Node) => {
      const nd = node.data as { node?: { data_type?: string; document_column?: string; name?: string; can_undo?: boolean; can_redo?: boolean } };
      const dt = nd?.node?.data_type ?? 'unknown';
      const docc = nd?.node?.document_column || '';
      const name = nd?.node?.name || '';
      const canUndo = nd?.node?.can_undo ? '1' : '0';
      const canRedo = nd?.node?.can_redo ? '1' : '0';
      return `${node.id}:${dt}:${docc}:${name}:${canUndo}:${canRedo}`;
    })
    .join(',');

  const newNodesSignature = initialNodes
    .map((node: Node) => {
      const nd = node.data as { node?: { data_type?: string; document_column?: string; name?: string; can_undo?: boolean; can_redo?: boolean } };
      const dt = nd?.node?.data_type ?? 'unknown';
      const docc = nd?.node?.document_column || '';
      const name = nd?.node?.name || '';
      const canUndo = nd?.node?.can_undo ? '1' : '0';
      const canRedo = nd?.node?.can_redo ? '1' : '0';
      return `${node.id}:${dt}:${docc}:${name}:${canUndo}:${canRedo}`;
    })
    .join(',');

  const updateRafRef = useRef<number | null>(null);
  useEffect(() => {
    if (
      newNodeIds === currentNodeIds &&
      newEdgeIds === currentEdgeIds &&
      newNodesSignature === currentNodesSignature
    ) {
      return;
    }

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
      if (updateRafRef.current) {
        cancelAnimationFrame(updateRafRef.current);
      }
    };
  }, [currentEdgeIds, currentNodeIds, currentNodesSignature, dlog, initialEdges, initialNodes, newEdgeIds, newNodeIds, newNodesSignature, setEdges, setNodes]);

  useEffect(() => {
    dlog('WorkspaceGraphView: React Flow state changed', {
      nodes: nodes.length,
      edges: edges.length,
    });
  }, [nodes, edges, dlog]);

  useEffect(() => {
    setNodes((existing) =>
      existing.map((node: Node) => ({
        ...node,
        selected: selectedNodeIds?.includes?.(node.id) ?? false,
        data: {
          ...node.data,
          isMultiSelected:
            (selectedNodeIds?.length || 0) > 1 && Boolean(selectedNodeIds?.includes?.(node.id)),
        },
      }))
    );
  }, [selectedNodeIds, setNodes]);

  useEffect(() => {
    if (!selectedNodeIds || selectedNodeIds.length === 0) {
      setNodes((existing) =>
        existing.map((node: Node) => ({
          ...node,
          selected: false,
          data: { ...node.data, isMultiSelected: false },
        }))
      );
    }
  }, [selectedNodeIds, setNodes]);

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const normalized = (changes || []).map((change: NodeChange) => {
        if (change.type === 'select') {
          return { ...change, selected: selectedNodeIds?.includes?.(change.id) ?? false };
        }
        return change;
      });
      onNodesChange(normalized);
    },
    [onNodesChange, selectedNodeIds]
  );

  const handlePaneClick = useCallback(() => {
    setNodes((existing) =>
      existing.map((node: Node) => ({
        ...node,
        selected: selectedNodeIds?.includes?.(node.id) ?? false,
      }))
    );
  }, [selectedNodeIds, setNodes]);

  const handleNodeClick: NodeMouseHandler = useCallback(
    (event, node) => {
      event.preventDefault();
      event.stopPropagation();
      if (node && node.id) {
        toggleNodeSelection?.(node.id);
      }
    },
    [toggleNodeSelection]
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      dlog('WorkspaceGraphView: onConnect blocked - manual edges disabled', connection);
    },
    [dlog]
  );

  const handleConnectStart = useCallback(
    (_event: MouseEvent | TouchEvent, params: { nodeId: string | null; handleId: string | null; handleType: string | null }) => {
      dlog('WorkspaceGraphView: onConnectStart blocked', params);
    },
    [dlog]
  );

  const handleConnectEnd = useCallback(
    (_event: MouseEvent | TouchEvent) => {
      dlog('WorkspaceGraphView: onConnectEnd blocked');
    },
    [dlog]
  );

  const handleInit = useCallback((instance: ReactFlowInstance) => {
    try {
      instance.fitView({ padding: 0.2, includeHiddenNodes: false });
    } catch (error) {
      dlog('WorkspaceGraphView: fitView error (ignored)', error);
    }
  }, [dlog]);

  const selectedCount = selectedNodeIds?.length ?? 0;
  const totalNodes = workspaceGraph?.nodes?.length ?? 0;

  return {
    nodes,
    edges,
    nodeTypes,
    isGraphLoading: Boolean(isLoading.graph),
    showEmptyState: !isLoading.graph && !currentWorkspaceId,
    selectedCount,
    totalNodes,
    canClearSelection: selectedCount > 0,
    handleNodeClick,
    handleNodesChange,
    handleEdgesChange: onEdgesChange,
    handlePaneClick,
    handleConnect,
    handleConnectStart,
    handleConnectEnd,
    handleInit,
    clearSelection,
    connectionLineType: ConnectionLineType.Bezier,
    defaultEdgeOptions: {
      type: 'default',
      animated: true,
      style: {
        strokeDasharray: '6 4',
        strokeWidth: 2.5,
        stroke: EDGE_STROKE,
      },
    },
  };
};
