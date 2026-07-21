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
import type { WorkspaceGraphNode as GraphNode, WorkspaceGraphEdge as GraphEdge } from '@/api';
import { useWorkspaceActions } from '@/features/workspace/common/hooks/useWorkspaceActions';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import { useWorkspaceSelection } from '@/features/workspace/common/hooks/useWorkspaceSelection';
import { useWorkspaceStatus } from '@/features/workspace/common/hooks/useWorkspaceStatus';
import { useFreshNodesStore } from '@/stores/freshNodesStore';
import { useNodeInputRequestsStore } from '@/stores/nodeInputRequestsStore';
import { useSelectionStore } from '@/stores/selectionStore';
import { useUIStore } from '@/stores';
import { computeDagreLayout } from '../services/graphLayout';
import { projectWorkspaceGraphNodeCard, type WorkspaceGraphNodeCard } from '../graphNodeModel';

const EDGE_STROKE = '#0f172a';
const EMPTY_FRESH_IDS = new Set<string>();
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

interface ProjectedNodeData {
  node: WorkspaceGraphNodeCard;
  isFresh: boolean;
}

/**
 * Projects every backend/freshness field rendered by `CustomNode` into a
 * serializable change signature.
 * Used by: `useWorkspaceGraph` reconciliation, where React Flow keeps its own
 * node state and must only be replaced when rendered backend presentation
 * changes. Drag position and selection are intentionally excluded because
 * React Flow owns position and the dedicated selection effect owns selection.
 */
const nodePresentationFor = (node: Node) => {
  const data = node.data as unknown as ProjectedNodeData;
  return {
    id: node.id,
    type: node.type,
    hidden: node.hidden,
    selectable: node.selectable,
    connectable: node.connectable,
    node: data.node,
    isFresh: data.isFresh,
  };
};

/**
 * Projects every rendered React Flow edge field into a serializable signature.
 * Used by: graph reconciliation so label/style changes refresh an existing
 * edge even when its source and target topology are unchanged.
 */
const edgePresentationFor = (edge: Edge) => ({
  id: edge.id,
  source: edge.source,
  target: edge.target,
  type: edge.type,
  animated: edge.animated,
  label: edge.label ?? null,
  hidden: edge.hidden,
  style: edge.style ?? null,
});

/**
 * Merges incoming backend presentation into React Flow-owned node state.
 * Used by: the presentation reconciliation effect when graph topology is
 * unchanged. Existing IDs retain their temporary dragged position, selection,
 * measurement, and drag state while rendered metadata refreshes.
 */
const reconcileProjectedNodes = (existingNodes: Node[], incomingNodes: Node[]): Node[] => {
  const existingById = new Map(existingNodes.map((node) => [node.id, node]));
  return incomingNodes.map((incomingNode) => {
    const existingNode = existingById.get(incomingNode.id);
    if (!existingNode) return incomingNode;
    return {
      ...existingNode,
      ...incomingNode,
      position: existingNode.position,
      selected: existingNode.selected,
      measured: existingNode.measured,
      dragging: existingNode.dragging,
    };
  });
};

/**
 * Builds the React Flow view model consumed by `WorkspaceGraphFeature`.
 * Used by: `WorkspaceGraphFeature`, whose React Flow shell needs backend graph
 * data, semantic selection handlers, and node commands in one view model.
 * Flow: workspace graph data is laid out and converted into React Flow nodes (selected/unselected state + fresh-node markers) before handlers update selection and navigation.
 */
export const useWorkspaceGraph = (): WorkspaceGraphViewModel => {
  const { workspaceGraph, currentWorkspaceId } = useWorkspaceData();
  const { selectedNodeIds } = useWorkspaceSelection();
  const { isLoading } = useWorkspaceStatus();
  const { deleteNode, copyNode, renameNode, undoNode, redoNode, toggleNode, clearSelection } =
    useWorkspaceActions();

  // React Flow owns node-data identity between hook renders, so command
  // adapters stay stable while reading the latest provider actions from this
  // ref. The effect refreshes the ref after workspace/action changes without
  // making command context part of the serializable presentation signature.
  const graphCommandsRef = useRef({ deleteNode, copyNode, renameNode, undoNode, redoNode });
  useEffect(() => {
    graphCommandsRef.current = { deleteNode, copyNode, renameNode, undoNode, redoNode };
  }, [copyNode, deleteNode, redoNode, renameNode, undoNode]);

  /** Deletes a graph node through workspace actions. */
  const handleDelete = useCallback((nodeId: string) => {
    if (!nodeId) {
      return;
    }
    void graphCommandsRef.current.deleteNode(nodeId);
  }, []);

  /** Renames a graph node through workspace actions. */
  const handleRename = useCallback((nodeId: string, newName: string) => {
    if (!nodeId || !newName.trim()) {
      return;
    }
    void graphCommandsRef.current.renameNode(nodeId, newName.trim());
  }, []);

  /** Clones a graph node through workspace actions. */
  const handleCopy = useCallback((nodeId: string) => {
    if (!nodeId) {
      return;
    }
    void graphCommandsRef.current.copyNode(nodeId);
  }, []);

  /** Undoes the last session edit for a graph Data Block. */
  const handleUndo = useCallback((nodeId: string) => {
    if (!nodeId) return;
    void graphCommandsRef.current.undoNode(nodeId);
  }, []);

  /** Redoes the last undone session edit for a graph Data Block. */
  const handleRedo = useCallback((nodeId: string) => {
    if (!nodeId) return;
    void graphCommandsRef.current.redoNode(nodeId);
  }, []);

  // "Fresh" = nodes that appeared mid-session (detach / join / stack /
  // clone / etc. outputs) and haven't been interacted with yet. The
  // graph marks them with a red "new" dot so the user can find them in
  // a busy workspace. ``observeNodeIds`` is called from a useEffect
  // below so the side-effect doesn't fire inside useMemo.
  const freshIds = useFreshNodesStore(
    (state) =>
      (currentWorkspaceId
        ? state.freshnessByWorkspace.get(currentWorkspaceId)?.freshIds
        : undefined) ?? EMPTY_FRESH_IDS,
  );
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
   *
   * The active view is read live from the store at click time rather than
   * closed over. React Flow caches each node's ``data`` (including this
   * callback) in its own internal state, and the graph's node-sync effect only
   * pushes fresh node data when a *visible* field changes (see
   * serializable presentation signature). A plain view switch changes no
   * visible field, so a
   * captured ``currentView`` would stay frozen at whatever view was active when
   * the nodes were last synced — tagging the request with the wrong view so no
   * mounted analysis consumer matches it and the "+" silently does nothing.
   * Reading ``getState()`` sidesteps that staleness entirely.
   */
  const handleAddToSelection = useCallback(
    (nodeId: string) => {
      if (!nodeId) return;
      const activeView = useUIStore.getState().currentView;
      const workspaceId = useSelectionStore.getState().currentWorkspaceId;
      requestNodeInputAdd(workspaceId, activeView, nodeId);
      if (workspaceId) markInteracted(workspaceId, [nodeId]);
    },
    [requestNodeInputAdd, markInteracted],
  );
  const currentGraphNodeIds = useMemo(
    () => (workspaceGraph?.nodes ?? []).map((n: GraphNode) => n.id),
    [workspaceGraph],
  );
  useEffect(() => {
    if (currentWorkspaceId) observeNodeIds(currentWorkspaceId, currentGraphNodeIds);
  }, [currentGraphNodeIds, currentWorkspaceId, observeNodeIds]);

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
      const position = positions.get(node.id) ?? { x: index * 320, y: 50 };

      return {
        id: node.id,
        type: 'customNode',
        position,
        data: {
          node: projectWorkspaceGraphNodeCard(node),
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

  const currentNodesSignature = JSON.stringify(nodes.map(nodePresentationFor));
  const newNodesSignature = JSON.stringify(initialNodes.map(nodePresentationFor));
  const currentEdgesSignature = JSON.stringify(edges.map(edgePresentationFor));
  const newEdgesSignature = JSON.stringify(initialEdges.map(edgePresentationFor));
  const currentTopologySignature = JSON.stringify({
    nodeIds: nodes.map((node) => node.id),
    edges: edges.map((edge) => [edge.source, edge.target]),
  });
  const newTopologySignature = JSON.stringify({
    nodeIds: initialNodes.map((node) => node.id),
    edges: initialEdges.map((edge) => [edge.source, edge.target]),
  });
  const nodesPresentationChanged = newNodesSignature !== currentNodesSignature;
  const edgesPresentationChanged = newEdgesSignature !== currentEdgesSignature;
  const topologyChanged = newTopologySignature !== currentTopologySignature;
  const renderedWorkspaceIdRef = useRef(currentWorkspaceId);

  const updateRafRef = useRef<number | null>(null);
  useEffect(() => {
    const workspaceChanged = renderedWorkspaceIdRef.current !== currentWorkspaceId;
    if (
      !workspaceChanged &&
      !topologyChanged &&
      !nodesPresentationChanged &&
      !edgesPresentationChanged
    ) {
      return;
    }

    if (updateRafRef.current) {
      cancelAnimationFrame(updateRafRef.current);
    }

    updateRafRef.current = requestAnimationFrame(() => {
      if (workspaceChanged || topologyChanged) {
        // Workspace identity and graph topology define the canonical Dagre
        // layout. Temporary React Flow drag positions never cross either
        // boundary.
        setNodes(initialNodes);
        setEdges(initialEdges);
        renderedWorkspaceIdRef.current = currentWorkspaceId;
      } else if (nodesPresentationChanged) {
        setNodes((existingNodes) => reconcileProjectedNodes(existingNodes, initialNodes));
      }
      if (!workspaceChanged && !topologyChanged && edgesPresentationChanged) {
        setEdges(initialEdges);
      }
    });

    return () => {
      if (updateRafRef.current) {
        cancelAnimationFrame(updateRafRef.current);
      }
    };
  }, [
    currentEdgesSignature,
    currentNodesSignature,
    currentWorkspaceId,
    edgesPresentationChanged,
    initialEdges,
    initialNodes,
    newEdgesSignature,
    newNodesSignature,
    nodesPresentationChanged,
    setEdges,
    setNodes,
    topologyChanged,
  ]);

  useEffect(() => {
    setNodes((existing) =>
      existing.map((node: Node) => ({
        ...node,
        selected: selectedNodeIds.includes(node.id),
      })),
    );
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
        toggleNode(node.id);
        // A click counts as "I've seen this" — clear the fresh-node
        // highlight even if the resulting selection toggle didn't
        // actually fire (e.g. parent disabled clicks).
        const workspaceId = useSelectionStore.getState().currentWorkspaceId;
        if (workspaceId) markInteracted(workspaceId, [node.id]);
      }
    },
    [toggleNode, markInteracted],
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
