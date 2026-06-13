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
import type { WorkspaceNodeInfo as GraphNode, WorkspaceGraphEdge as GraphEdge } from '@/api';
import { useWorkspaceActions } from '@/features/workspace/common/hooks/useWorkspaceActions';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import { useWorkspaceSelection } from '@/features/workspace/common/hooks/useWorkspaceSelection';
import { useWorkspaceStatus } from '@/features/workspace/common/hooks/useWorkspaceStatus';
import { nodeVisualInfo } from '@/lib/nodeVisualState';
import { useNodeColorsStore } from '@/stores/nodeColorsStore';
import { useFreshNodesStore } from '@/stores/freshNodesStore';
import { useNodeInputRequestsStore } from '@/stores/nodeInputRequestsStore';
import { useUIStore } from '@/stores';
import { computeDagreLayout } from '../services/graphLayout';

const EDGE_STROKE = '#0f172a';
/** Registers the React Flow node renderer used for workspace graph nodes. */
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
  handleConnectStart: (
    event: MouseEvent | TouchEvent,
    params: { nodeId: string | null; handleId: string | null; handleType: string | null },
  ) => void;
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

/**
 * Builds the React Flow view model consumed by `WorkspaceGraphFeature`.
 * Used by: nodeColorsStore module, WorkspaceGraphFeature component, CustomNode component (rg call sites/imports) because the graph shell needs backend graph data converted to React Flow state.
 * Flow: workspace graph data is laid out, colored, and converted into React Flow nodes before handlers update selection and navigation.
 */
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

  /** Deletes a graph node through workspace actions. */
  const handleDelete = useCallback(
    (nodeId: string) => {
      if (!nodeId) {
        return;
      }
      void deleteNode(nodeId);
    },
    [deleteNode],
  );

  /** Renames a graph node through workspace actions. */
  const handleRename = useCallback(
    (nodeId: string, newName: string) => {
      if (!nodeId || !newName.trim()) {
        return;
      }
      void renameNode(nodeId, newName.trim());
    },
    [renameNode],
  );

  /** Clones a graph node through workspace actions. */
  const handleCopy = useCallback(
    (nodeId: string) => {
      if (!nodeId) {
        return;
      }
      void copyNode(nodeId);
    },
    [copyNode],
  );

  /** Applies an undo operation to a graph node. */
  const handleUndo = useCallback(
    (nodeId: string) => {
      if (!nodeId) {
        return;
      }
      void undoNode(nodeId);
    },
    [undoNode],
  );

  /** Applies a redo operation to a graph node. */
  const handleRedo = useCallback(
    (nodeId: string) => {
      if (!nodeId) {
        return;
      }
      void redoNode(nodeId);
    },
    [redoNode],
  );

  // Per-node visual state (active / focus / unselected + X/Y colour pair)
  // is computed here once per render so CustomNode is purely presentational
  // — it just renders what data carries. See the strategy doc for the
  // active/focus split rules.
  const assignedColors = useNodeColorsStore((state) => state.colors);
  // Zustand store actions are stable closures and never rely on `this`, so
  // selecting them directly is safe despite unbound-method.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const pruneStaleColors = useNodeColorsStore((state) => state.pruneStaleColors);
  const currentView = useUIStore((state) => state.currentView);
  // "Fresh" = nodes that appeared mid-session (detach / join / stack /
  // clone / etc. outputs) and haven't been interacted with yet. The
  // graph paints them with a black outline overlay so the user can
  // find them in a busy workspace. ``observeNodeIds`` is called from
  // a useEffect below so the side-effect doesn't fire inside useMemo.
  const freshIds = useFreshNodesStore((state) => state.freshIds);
  // Zustand store actions are stable closures and never rely on `this`, so
  // selecting them directly is safe despite unbound-method.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const observeNodeIds = useFreshNodesStore((state) => state.observeNodeIds);
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const markInteracted = useFreshNodesStore((state) => state.markInteracted);
  const requestNodeInputAdd = useNodeInputRequestsStore((state) => state.requestAdd);

  /**
   * Requests that the active view add this node to its owned input selection.
   * Called by: CustomNode's fixed-size side controls. The graph does not own
   * analysis inputs, so this queues an intent consumed by useTabNodeInputs in
   * the currently mounted view instead of selecting/highlighting the graph node.
   */
  const handleAddToSelection = useCallback(
    (nodeId: string) => {
      if (!nodeId) return;
      requestNodeInputAdd(currentWorkspaceId, currentView, nodeId);
      markInteracted([nodeId]);
    },
    [requestNodeInputAdd, currentWorkspaceId, currentView, markInteracted],
  );
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
      workspaceGraph.edges.map((edge: GraphEdge) => ({
        source: edge.source,
        target: edge.target,
      })),
      { rankdir: 'LR', ranksep: 140, nodesep: 100 },
    );

    return workspaceGraph.nodes.map((node: GraphNode, index: number) => {
      const columns = Array.isArray(node.columns)
        ? node.columns.map((column: unknown) => String(column))
        : [];

      const columnSchema =
        node.schema && typeof node.schema === 'object'
          ? Object.entries(node.schema as Record<string, unknown>).reduce<Record<string, string>>(
              (acc, [key, value]) => {
                acc[key] = String(value);
                return acc;
              },
              {},
            )
          : {};

      const documentColumn =
        typeof node.document === 'string' && node.document.trim().length > 0 ? node.document : null;

      const shapeCandidate = (node as { shape?: unknown[] }).shape;
      const rawShape: unknown[] | null = Array.isArray(shapeCandidate) ? shapeCandidate : null;
      const parsedShape: [number | null, number | null] =
        rawShape && rawShape.length >= 2
          ? [
              typeof rawShape[0] === 'number' ? rawShape[0] : null,
              typeof rawShape[1] === 'number' ? rawShape[1] : null,
            ]
          : [null, null];

      const position = positions.get(node.id) ?? { x: index * 320, y: 50 };

      return {
        id: node.id,
        type: 'customNode',
        position,
        data: {
          node: {
            node_id: node.id,
            name: node.name || `Node ${String(index + 1)}`,
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
          },
          isMultiSelected:
            selectedNodeIds.length > 1 && selectedNodeIds.includes(node.id),
          visualInfo: nodeVisualInfo(node.id, {
            selectedNodeIds,
            currentView,
            assignedColors,
          }),
          isFresh: freshIds.has(node.id),
          onDelete: handleDelete,
          onRename: handleRename,
          onCopy: handleCopy,
          onUndo: handleUndo,
          onRedo: handleRedo,
          onAddToSelection: handleAddToSelection,
        },
        hidden: false,
        selectable: true,
        selected: selectedNodeIds.includes(node.id),
        connectable: false,
      };
    });
  }, [
    workspaceGraph,
    selectedNodeIds,
    currentView,
    assignedColors,
    freshIds,
    handleDelete,
    handleRename,
    handleCopy,
    handleUndo,
    handleRedo,
    handleAddToSelection,
  ]);

  const initialEdges = useMemo(() => {
    if (!workspaceGraph?.edges) {
      return [];
    }
    return workspaceGraph.edges.map((edge: GraphEdge, index: number) => ({
      id: `edge-${edge.source}-${edge.target}-${String(index)}`,
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
  // The explicit <Edge> is required: without it the hook infers the narrow
  // shape of `initialEdges`, so `onEdgesChange` becomes OnEdgesChange<that
  // shape> and no longer satisfies the OnEdgesChange<Edge> consumer below.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-arguments
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
  interface NodeDataSignatureShape {
    node?: {
      data_type?: string;
      document_column?: string;
      name?: string;
      can_undo?: boolean;
      can_redo?: boolean;
    };
    visualInfo?: { state?: string; pair?: { X?: string } };
    isFresh?: boolean;
  }
  /**
   * Encodes visible node fields so React Flow state refreshes when they change.
   * Called by: useWorkspaceGraph internal event, effect, or helper flow.
   * Why: because the graph hook needs helpers that bridge backend graph data, React Flow events, and workspace selection state.
   * Flow: collect visible metadata, visual state, and freshness into one string used for change detection.
   */
  const nodeSignatureFor = (node: Node): string => {
    const nd = node.data as NodeDataSignatureShape;
    const dt = nd.node?.data_type ?? 'unknown';
    const docc = nd.node?.document_column ?? '';
    const name = nd.node?.name ?? '';
    const canUndo = nd.node?.can_undo ? '1' : '0';
    const canRedo = nd.node?.can_redo ? '1' : '0';
    const vis = nd.visualInfo;
    const visToken = `${vis?.state ?? '-'}:${vis?.pair?.X ?? '-'}`;
    const freshToken = nd.isFresh ? '1' : '0';
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
  }, [
    currentEdgeIds,
    currentNodeIds,
    currentNodesSignature,
    initialEdges,
    initialNodes,
    newEdgeIds,
    newNodeIds,
    newNodesSignature,
    setEdges,
    setNodes,
  ]);

  useEffect(() => {
    setNodes((existing) =>
      existing.map((node: Node) => ({
        ...node,
        selected: selectedNodeIds.includes(node.id),
        data: {
          ...node.data,
          isMultiSelected:
            selectedNodeIds.length > 1 && selectedNodeIds.includes(node.id),
        },
      })),
    );
  }, [selectedNodeIds, setNodes]);

  useEffect(() => {
    if (selectedNodeIds.length === 0) {
      setNodes((existing) =>
        existing.map((node: Node) => ({
          ...node,
          selected: false,
          data: { ...node.data, isMultiSelected: false },
        })),
      );
    }
  }, [selectedNodeIds, setNodes]);

  /** Keeps React Flow select changes aligned with the app selection store. */
  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const normalized = changes.map((change: NodeChange) => {
        if (change.type === 'select') {
          return { ...change, selected: selectedNodeIds.includes(change.id) };
        }
        return change;
      });
      onNodesChange(normalized);
    },
    [onNodesChange, selectedNodeIds],
  );

  /** Restores visual selection when pane clicks would otherwise clear React Flow state. */
  const handlePaneClick = useCallback(() => {
    setNodes((existing) =>
      existing.map((node: Node) => ({
        ...node,
        selected: selectedNodeIds.includes(node.id),
      })),
    );
  }, [selectedNodeIds, setNodes]);

  /** Toggles app-level node selection when a graph node is clicked. */
  const handleNodeClick: NodeMouseHandler = useCallback(
    (event, node) => {
      event.preventDefault();
      event.stopPropagation();
      if (node.id) {
        toggleNodeSelection(node.id);
        // A click counts as "I've seen this" — clear the fresh-node
        // highlight even if the resulting selection toggle didn't
        // actually fire (e.g. parent disabled clicks).
        markInteracted([node.id]);
      }
    },
    [toggleNodeSelection, markInteracted],
  );

  /** No-op connection handler because graph edges are backend-derived. */
  const handleConnect = useCallback((_connection: Connection) => {
    // No-op: graph edges are backend-derived, so user-drawn connections are ignored.
  }, []);

  /** No-op connection-start handler retained for React Flow prop parity. */
  const handleConnectStart = useCallback(
    (
      _event: MouseEvent | TouchEvent,
      _params: { nodeId: string | null; handleId: string | null; handleType: string | null },
    ) => {
      // No-op: retained for React Flow prop parity; graph edges are backend-derived.
    },
    [],
  );

  /** No-op connection-end handler retained for React Flow prop parity. */
  const handleConnectEnd = useCallback((_event: MouseEvent | TouchEvent) => {
    // No-op: retained for React Flow prop parity; graph edges are backend-derived.
  }, []);

  /** Fits the graph into view after React Flow initializes. */
  const handleInit = useCallback((instance: ReactFlowInstance) => {
    try {
      void instance.fitView({ padding: 0.2, includeHiddenNodes: false });
    } catch {
      // React Flow can reject fitView during teardown; layout remains usable.
    }
  }, []);

  const selectedCount = selectedNodeIds.length;
  const totalNodes = workspaceGraph?.nodes.length ?? 0;

  return {
    nodes,
    edges,
    nodeTypes,
    isGraphLoading: isLoading.graph,
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
