import { useQuery } from '@tanstack/react-query';
import { workspacesApi } from '../../api/workspaces';
import { nodesApi } from '../../api/nodes';
import { queryKeys } from '../../lib/queryKeys';
import type { GraphNode, NodeDataResponse } from '../../types/api';
import { type PaginationState } from './types';

interface WorkspaceQueriesParams {
  authHeaders: Record<string, string>;
  isAuthenticated: boolean;
  currentWorkspaceId: string | null;
  selectedNodeId: string | null;
  selectedNodeIds: string[];
  getPaginationForNode: (nodeId?: string | null) => PaginationState;
}

const DEBUG_GRAPH_KEY = 'debugGraph';

const logGraphDebug = (result: { nodes?: GraphNode[]; edges?: { source: string; target: string }[] }) => {
  if (typeof window === 'undefined') return;
  if (localStorage.getItem(DEBUG_GRAPH_KEY) !== '1') return;

  console.debug('=== API Response Success ===');
  console.debug('API response structure:', {
    nodes: result?.nodes?.length || 0,
    edges: result?.edges?.length || 0,
  });

  if (result?.nodes && result.nodes.length > 0) {
    const sampleNode = result.nodes[0]!;
    console.debug('Sample node structure:', {
      id: sampleNode.id,
      name: sampleNode.name,
      operation: sampleNode.operation,
    });
  }
};

export const useWorkspaceQueries = ({
  authHeaders,
  isAuthenticated,
  currentWorkspaceId,
  selectedNodeId,
  selectedNodeIds,
  getPaginationForNode,
}: WorkspaceQueriesParams) => {
  const workspacesQuery = useQuery({
    queryKey: queryKeys.workspaces,
    queryFn: () => workspacesApi.list(authHeaders),
    enabled: isAuthenticated,
    staleTime: 5 * 60 * 1000,
  });

  const currentWorkspaceQuery = useQuery({
    queryKey: queryKeys.currentWorkspace,
    queryFn: () => workspacesApi.current.get(authHeaders),
    enabled: isAuthenticated,
    staleTime: 60 * 1000,
  });

  const graphQuery = useQuery({
    queryKey: currentWorkspaceId
      ? queryKeys.workspaceGraph(currentWorkspaceId)
      : ['workspaces', 'graph'],
    queryFn: async () => {
      const result = await workspacesApi.graph(authHeaders);
      logGraphDebug(result);
      return result;
    },
    enabled: isAuthenticated && !!currentWorkspaceId,
    refetchOnWindowFocus: false,
    staleTime: 30 * 1000,
  });

  const nodeDataQuery = useQuery({
    queryKey: queryKeys.nodeData(
      currentWorkspaceId ?? '',
      selectedNodeId ?? '',
      getPaginationForNode(selectedNodeId).currentPage,
      getPaginationForNode(selectedNodeId).pageSize,
      getPaginationForNode(selectedNodeId).sortBy,
      getPaginationForNode(selectedNodeId).descending,
      getPaginationForNode(selectedNodeId).filterColumn,
      getPaginationForNode(selectedNodeId).filterValue,
    ),
    queryFn: () => {
      if (!currentWorkspaceId || !selectedNodeId) throw new Error('Missing workspace or node ID');
      const { currentPage, pageSize, sortBy, descending, filterColumn, filterValue, filterOp } = getPaginationForNode(selectedNodeId);
      return nodesApi.data(selectedNodeId, {
        page: currentPage,
        pageSize,
        sortBy,
        descending,
        filterColumn,
        filterValue,
        filterOp,
      }, authHeaders);
    },
    enabled: isAuthenticated && !!currentWorkspaceId && !!selectedNodeId,
    staleTime: 30 * 1000,
  });

  const workspaces = workspacesQuery.data || [];
  const currentWorkspace =
    workspaces.find((workspace) => workspace.id === currentWorkspaceId) || null;
  const workspaceGraph = graphQuery.data || null;

  const nodes = workspaceGraph?.nodes ?? [];
  const selectedNode = nodes.find((node) => node.id === selectedNodeId) || null;

  const selectedNodes = selectedNodeIds
        .map((id: string) => nodes.find((node) => node.id === id))
        .filter((n): n is GraphNode => Boolean(n));

  const nodeData: NodeDataResponse = nodeDataQuery.data || { data: [], pagination: { page: 0, page_size: 20, total_rows: 0, total_pages: 0, has_next: false, has_prev: false }, columns: [], dtypes: {} };

  const queryLoadingState = ({
      workspaces: workspacesQuery.isLoading,
      currentWorkspace: currentWorkspaceQuery.isLoading,
      nodes: graphQuery.isLoading,
      graph: graphQuery.isLoading,
      nodeData: nodeDataQuery.isLoading,
    });

  const queryErrorState = ({
      workspaces: workspacesQuery.error?.message || null,
      currentWorkspace: currentWorkspaceQuery.error?.message || null,
      nodes: graphQuery.error?.message || null,
      graph: graphQuery.error?.message || null,
      nodeData: nodeDataQuery.error?.message || null,
    });

  return {
    workspacesQuery,
    currentWorkspaceQuery,
    graphQuery,
    nodeDataQuery,
    workspaces,
    currentWorkspace,
    workspaceGraph,
    nodes,
    selectedNode,
    selectedNodes,
    nodeData,
    queryLoadingState,
    queryErrorState,
    currentWorkspaceIdFromQuery: currentWorkspaceQuery.data,
    currentWorkspaceQueryError: currentWorkspaceQuery.isError,
  } as const;
};
