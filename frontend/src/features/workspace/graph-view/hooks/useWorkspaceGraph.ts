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
import { nodeVisualInfo } from '@/lib/nodeVisualState';
import { useNodeColorsStore } from '@/stores/nodeColorsStore';
import { useFreshNodesStore } from '@/stores/freshNodesStore';
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
  const pruneStaleColors = useNodeColorsStore((state) => state.pruneStaleColors);
  const currentView = useUIStore((state) => state.currentView);
  // "Fresh" = nodes that appeared mid-session (detach / join / stack /
  // clone / etc. outputs) and haven't been interacted with yet. The
  // graph paints them with a black outline overlay so the user can
  // find them in a busy workspace. ``observeNodeIds`` is called from
  // a useEffect below so the side-effect doesn't fire inside useMemo.
  const freshIds = useFreshNodesStore((state) => state.freshIds);
  const observeNodeIds = useFreshNodesStore((state) => state.observeNodeIds);
  const markInteracted = useFreshNodesStore((state) => state.markInteracted);
  const currentGraphNodeIds = useMemo(
    () => (workspaceGraph?.nodes ?? []).map((n: GraphNode) => n.id),
    [workspaceGraph],
  );
  useEffect(() => {
    observeNodeIds(currentGraphNodeIds);
    // Drop colour entries for nodes that are no longer in the
    // workspace (deleted via the graph or the API). Keeps the store
    // — and the persisted sidecar, once that lands — free of stale
    // colour metadata that would otherwise grow unbounded.
    pruneStaleColors(currentGraphNodeIds);
  }, [currentGraphNodeIds, observeNodeIds, pruneStaleColors]);

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

      const rawTokenization = (node as { tokenization?: unknown }).tokenization;
      const passthroughTokenization =
        rawTokenization && typeof rawTokenization === 'object' && !Array.isArray(rawTokenization)
          ? (rawTokenization as Record<string, unknown>)
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
            tokenization: passthroughTokenization,
          },
          isMultiSelected:
            (selectedNodeIds?.length || 0) > 1 && Boolean(selectedNodeIds?.includes?.(node.id)),
          visualInfo: nodeVisualInfo(node.id, {
            selectedNodeIds: selectedNodeIds ?? [],
            currentView,
            assignedColors,
          }),
          isFresh: freshIds.has(node.id),
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
  }, [workspaceGraph, selectedNodeIds, currentView, assignedColors, freshIds, handleDelete, handleRename, handleCopy, handleUndo, handleRedo]);

  const initialEdges = useMemo(() => {
    if (!workspaceGraph?.edges) {
      return [];
    }
    return workspaceGraph.edges.map((edge: GraphEdge, index: number) => ({
      id: `edge-${edge.source}-${edge.target}-${index}`,
      source: edge.source,
      target: edge.target,
      type: 'default',
      animated: true,
      label: edge.label ?? undefined,
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

  /** Pull the fields the signature tracks. Colour state lives at
   * ``data.visualInfo`` — pre-fix it was excluded, so when a node's
   * assigned colour or active/focus state changed, the signature was
   * identical and ``setNodes`` was skipped, leaving CustomNode rendered
   * with stale data. Encode ``state:X`` (state + the bold colour) so
   * any visible-colour change drives a re-render. */
  type NodeDataSignatureShape = {
    node?: {
      data_type?: string;
      document_column?: string;
      name?: string;
      can_undo?: boolean;
      can_redo?: boolean;
    };
    visualInfo?: { state?: string; pair?: { X?: string } };
    isFresh?: boolean;
  };
  const nodeSignatureFor = (node: Node): string => {
    const nd = node.data as NodeDataSignatureShape;
    const dt = nd?.node?.data_type ?? 'unknown';
    const docc = nd?.node?.document_column || '';
    const name = nd?.node?.name || '';
    const canUndo = nd?.node?.can_undo ? '1' : '0';
    const canRedo = nd?.node?.can_redo ? '1' : '0';
    const vis = nd?.visualInfo;
    const visToken = `${vis?.state ?? '-'}:${vis?.pair?.X ?? '-'}`;
    const freshToken = nd?.isFresh ? '1' : '0';
    return `${node.id}:${dt}:${docc}:${name}:${canUndo}:${canRedo}:${visToken}:${freshToken}`;
  };

  const currentNodesSignature = nodes.map(nodeSignatureFor).join(',');
  const newNodesSignature = initialNodes.map(nodeSignatureFor).join(',');

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
      setNodes(initialNodes);
      setEdges(initialEdges);
    });

    return () => {
      if (updateRafRef.current) {
        cancelAnimationFrame(updateRafRef.current);
      }
    };
  }, [currentEdgeIds, currentNodeIds, currentNodesSignature, initialEdges, initialNodes, newEdgeIds, newNodeIds, newNodesSignature, setEdges, setNodes]);

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
        // A click counts as "I've seen this" — clear the fresh-node
        // highlight even if the resulting selection toggle didn't
        // actually fire (e.g. parent disabled clicks).
        markInteracted([node.id]);
      }
    },
    [toggleNodeSelection, markInteracted]
  );

  const handleConnect = useCallback(
    (_connection: Connection) => {},
    []
  );

  const handleConnectStart = useCallback(
    (_event: MouseEvent | TouchEvent, _params: { nodeId: string | null; handleId: string | null; handleType: string | null }) => {},
    []
  );

  const handleConnectEnd = useCallback(
    (_event: MouseEvent | TouchEvent) => {},
    []
  );

  const handleInit = useCallback((instance: ReactFlowInstance) => {
    try {
      instance.fitView({ padding: 0.2, includeHiddenNodes: false });
    } catch {
      // React Flow can reject fitView during teardown; layout remains usable.
    }
  }, []);

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
