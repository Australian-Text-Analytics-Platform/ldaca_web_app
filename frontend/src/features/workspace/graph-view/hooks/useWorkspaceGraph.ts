import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Connection,
  ConnectionLineType,
  Edge,
  Node,
  NodeMouseHandler,
  ReactFlowInstance,
  useEdgesState,
  useNodesState,
} from '@xyflow/react';

import CustomNode from '@/components/CustomNode';
import { useWorkspaceActions } from '@/hooks/useWorkspaceActions';
import { useWorkspaceData } from '@/hooks/useWorkspaceData';
import { useWorkspaceSelection } from '@/hooks/useWorkspaceSelection';
import { useWorkspaceStatus } from '@/hooks/useWorkspaceStatus';
import type { NodeShape as WorkspaceNodeShape } from '../../../../types';

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
  handleConnectStart: (event: any, params: any) => void;
  handleConnectEnd: (event: any) => void;
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
    renameNode,
    toggleNodeSelection,
    clearSelection,
  } = useWorkspaceActions();

  const DEBUG_GRAPH =
    typeof window !== 'undefined' &&
    ((window as any).__LDACA_DEBUG_GRAPH || localStorage.getItem('debugGraph') === '1');
  const dlog = useCallback((...args: any[]) => {
    if (DEBUG_GRAPH) {
      console.log(...args);
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


  const initialNodes = useMemo(() => {
    if (!workspaceGraph?.nodes) {
      return [];
    }

    const positions = computeDagreLayout(
      workspaceGraph.nodes.map((n: any) => ({ id: n.id })),
      (workspaceGraph.edges || []).map((edge: any) => ({ source: edge.source, target: edge.target })),
      { rankdir: 'LR', ranksep: 140, nodesep: 100 }
    );

    return workspaceGraph.nodes.map((node: any, index: number) => {
      const rawNodeType = node.data?.nodeType || node.data?.dataType || node.data?.type || node.type || '';
      const dataType = rawNodeType || 'unknown';
      const columns = Array.isArray(node.data?.columns) ? node.data.columns : [];
      const isLazyNode = Boolean(
        node.data?.lazy ||
        (typeof rawNodeType === 'string' && rawNodeType.toLowerCase().includes('lazyframe'))
      );

      dlog('WorkspaceGraphView: Raw node data (condensed):', {
        id: node.id,
        nodeType: rawNodeType,
        isLazy: isLazyNode,
        documentColumn: node.data?.documentColumn,
      });

      const backendShape = node.data?.shape;
      const shape: WorkspaceNodeShape = [null, null];
      if (backendShape && Array.isArray(backendShape) && backendShape.length === 2) {
        shape[0] = typeof backendShape[0] === 'number' ? backendShape[0] : null;
        shape[1] = typeof backendShape[1] === 'number' ? backendShape[1] : null;
      }

      const position = positions.get(node.id) || { x: index * 320, y: 50 };

      return {
        id: node.id,
        type: 'customNode',
        position,
        data: {
          node: {
            node_id: node.id,
            name: node.data?.nodeName || node.data?.label || `Node ${index + 1}`,
            shape,
            columns,
            preview: [],
            is_text_data: Boolean(node.data?.dataType?.includes('Doc')),
            data_type: dataType,
            document_column: node.data?.documentColumn || null,
            column_schema: node.data?.schema
              ? Object.fromEntries(
                  node.data.schema.map((col: any) => [col.name, col.js_type])
                )
              : {},
          },
          isMultiSelected:
            (selectedNodeIds?.length || 0) > 1 && Boolean(selectedNodeIds?.includes?.(node.id)),
          onDelete: handleDelete,
          onRename: handleRename,
        },
        hidden: false,
        draggable: true,
        selectable: true,
        selected: selectedNodeIds?.includes?.(node.id) ?? false,
        connectable: false,
      } as Node;
    });
  }, [workspaceGraph, selectedNodeIds, handleDelete, handleRename, dlog]);

  const initialEdges = useMemo(() => {
    if (!workspaceGraph?.edges) {
      return [];
    }
    return workspaceGraph.edges.map((edge: any, index: number) => ({
      id: edge.id || `edge-${index}`,
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
    .map((node: any) => {
      const dt = node?.data?.node?.data_type ?? 'unknown';
      const docc = node?.data?.node?.document_column || '';
      const name = node?.data?.node?.name || '';
      return `${node.id}:${dt}:${docc}:${name}`;
    })
    .join(',');

  const newNodesSignature = initialNodes
    .map((node: any) => {
      const dt = node?.data?.node?.data_type ?? 'unknown';
      const docc = node?.data?.node?.document_column || '';
      const name = node?.data?.node?.name || '';
      return `${node.id}:${dt}:${docc}:${name}`;
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
      existing.map((node: any) => ({
        ...node,
        selected: selectedNodeIds?.includes?.(node.id) ?? false,
        data: {
          ...node.data,
          isMultiSelected:
            (selectedNodeIds?.length || 0) > 1 && Boolean(selectedNodeIds?.includes?.(node.id)),
        },
      })) as any
    );
  }, [selectedNodeIds, setNodes]);

  useEffect(() => {
    if (!selectedNodeIds || selectedNodeIds.length === 0) {
      setNodes((existing) =>
        existing.map((node: any) => ({
          ...node,
          selected: false,
          data: { ...node.data, isMultiSelected: false },
        })) as any
      );
    }
  }, [selectedNodeIds, setNodes]);

  const handleNodesChange = useCallback(
    (changes: any) => {
      const normalized = (changes || []).map((change: any) => {
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
      existing.map((node: any) => ({
        ...node,
        selected: selectedNodeIds?.includes?.(node.id) ?? false,
      })) as any
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
    (_event: any, params: any) => {
      dlog('WorkspaceGraphView: onConnectStart blocked', params);
    },
    [dlog]
  );

  const handleConnectEnd = useCallback(
    (_event: any) => {
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
