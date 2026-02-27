import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { workspacesApi } from '../../api/workspaces';
import { nodesApi } from '../../api/nodes';
import { queryKeys } from '../../lib/queryKeys';
import { PaginationState } from './types';

interface WorkspaceQueriesParams {
  authHeaders: Record<string, string>;
  isAuthenticated: boolean;
  currentWorkspaceId: string | null;
  selectedNodeId: string | null;
  selectedNodeIds: string[];
  getPaginationForNode: (nodeId?: string | null) => PaginationState;
}

const DEBUG_GRAPH_KEY = 'debugGraph';

const logGraphDebug = (result: any) => {
  if (typeof window === 'undefined') return;
  if (localStorage.getItem(DEBUG_GRAPH_KEY) !== '1') return;

  console.log('=== API Response Success ===');
  console.log('API response structure:', {
    nodes: result?.nodes?.length || 0,
    edges: result?.edges?.length || 0,
  });

  if (result?.nodes && result.nodes.length > 0) {
    const sampleNode = result.nodes[0];
    console.log('Sample node structure:', {
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
      currentWorkspaceId!,
      selectedNodeId!,
      getPaginationForNode(selectedNodeId).currentPage,
      getPaginationForNode(selectedNodeId).pageSize
    ),
    queryFn: () => {
      const { currentPage, pageSize } = getPaginationForNode(selectedNodeId);
      return nodesApi.data(selectedNodeId!, currentPage, pageSize, authHeaders);
    },
    enabled: isAuthenticated && !!currentWorkspaceId && !!selectedNodeId,
    staleTime: 30 * 1000,
  });

  const workspaces = workspacesQuery.data || [];
  const currentWorkspace =
    workspaces.find((workspace: any) => workspace.id === currentWorkspaceId) || null;
  const workspaceGraph = graphQuery.data || null;

  const nodes = useMemo(() => workspaceGraph?.nodes ?? [], [workspaceGraph]);
  const selectedNode = useMemo(
    () => nodes.find((node: any) => node.id === selectedNodeId) || null,
    [nodes, selectedNodeId]
  );

  const selectedNodes = useMemo(
    () =>
      selectedNodeIds
        .map((id: string) => nodes.find((node: any) => node.id === id))
        .filter(Boolean),
    [selectedNodeIds, nodes]
  );

  const nodeData = nodeDataQuery.data || { data: [], page: 0, total_pages: 0 };

  const queryLoadingState = useMemo(
    () => ({
      workspaces: workspacesQuery.isLoading,
      currentWorkspace: currentWorkspaceQuery.isLoading,
      nodes: graphQuery.isLoading,
      graph: graphQuery.isLoading,
      nodeData: nodeDataQuery.isLoading,
    }),
    [
      workspacesQuery.isLoading,
      currentWorkspaceQuery.isLoading,
      graphQuery.isLoading,
      nodeDataQuery.isLoading,
    ]
  );

  const queryErrorState = useMemo(
    () => ({
      workspaces: workspacesQuery.error?.message || null,
      currentWorkspace: currentWorkspaceQuery.error?.message || null,
      nodes: graphQuery.error?.message || null,
      graph: graphQuery.error?.message || null,
      nodeData: nodeDataQuery.error?.message || null,
    }),
    [
      workspacesQuery.error?.message,
      currentWorkspaceQuery.error?.message,
      graphQuery.error?.message,
      nodeDataQuery.error?.message,
    ]
  );

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
