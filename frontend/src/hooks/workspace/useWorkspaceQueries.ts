import { useCallback, useMemo } from 'react';
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
    workspace_info: !!result?.workspace_info,
  });

  if (result?.nodes && result.nodes.length > 0) {
    const sampleNode = result.nodes[0];
    console.log('Sample node structure:', {
      id: sampleNode.id,
      type: sampleNode.type,
      position: sampleNode.position,
      dataKeys: Object.keys(sampleNode.data || {}),
      sampleData: sampleNode.data,
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
    retry: false,
  });

  const currentWorkspaceQuery = useQuery({
    queryKey: queryKeys.currentWorkspace,
    queryFn: () => workspacesApi.current.get(authHeaders),
    enabled: isAuthenticated,
    staleTime: 60 * 1000,
    retry: false,
  });

  const graphQuery = useQuery({
    queryKey: currentWorkspaceId
      ? queryKeys.workspaceGraph(currentWorkspaceId)
      : ['workspaces', 'graph'],
    queryFn: async () => {
      const result = await workspacesApi.graph(currentWorkspaceId!, authHeaders);
      logGraphDebug(result);
      return result;
    },
    enabled: isAuthenticated && !!currentWorkspaceId,
    refetchOnWindowFocus: false,
    staleTime: 30 * 1000,
    retry: false,
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
      return nodesApi.data(currentWorkspaceId!, selectedNodeId!, currentPage, pageSize, authHeaders);
    },
    enabled: isAuthenticated && !!currentWorkspaceId && !!selectedNodeId,
    staleTime: 30 * 1000,
    retry: false,
  });

  const workspaces = workspacesQuery.data || [];
  const currentWorkspace =
    workspaces.find((workspace: any) => workspace.workspace_id === currentWorkspaceId) || null;
  const workspaceGraph = graphQuery.data || null;

  const nodes = useMemo(() => workspaceGraph?.nodes || [], [workspaceGraph?.nodes]);
  const selectedNode = nodes.find((node: any) => node.id === selectedNodeId) || null;

  const selectedNodes = useMemo(
    () =>
      selectedNodeIds
        .map((id: string) => nodes.find((node: any) => node.id === id))
        .filter(Boolean),
    [nodes, selectedNodeIds]
  );

  const nodeData = nodeDataQuery.data || { data: [], page: 0, total_pages: 0 };

  const getNodeShape = useCallback(
    async (
      nodeId: string
    ): Promise<{ shape: [number, number]; is_lazy: boolean; calculated: boolean } | null> => {
      if (!currentWorkspaceId) return null;

      const cacheKey = `node-shape:${currentWorkspaceId}:${nodeId}`;
      if (typeof window !== 'undefined') {
        try {
          const cached = window.sessionStorage.getItem(cacheKey);
          if (cached) {
            const parts = cached.split('×').map((token) => token.trim());
            if (parts.length === 2) {
              const r = parseInt(parts[0], 10);
              const c = parseInt(parts[1], 10);
              if (!Number.isNaN(r) && !Number.isNaN(c)) {
                return { shape: [r, c], is_lazy: false, calculated: true } as any;
              }
            }
          }
        } catch {
          // ignore cache read errors
        }
      }

      try {
        const shapeData = await nodesApi.shape(currentWorkspaceId, nodeId, authHeaders);
        if (shapeData?.shape && typeof window !== 'undefined') {
          try {
            window.sessionStorage.setItem(cacheKey, `${shapeData.shape[0]} × ${shapeData.shape[1]}`);
          } catch {
            // ignore cache write errors
          }
        }
        return shapeData;
      } catch (error) {
        console.error('Failed to get node shape:', error);
        return null;
      }
    },
    [authHeaders, currentWorkspaceId]
  );

  const queryLoadingState = useMemo(
    () => ({
      workspaces: workspacesQuery.isLoading,
      currentWorkspace: currentWorkspaceQuery.isLoading,
      nodes: graphQuery.isLoading,
      graph: graphQuery.isLoading,
      nodeData: nodeDataQuery.isLoading,
    }),
    [currentWorkspaceQuery.isLoading, graphQuery.isLoading, nodeDataQuery.isLoading, workspacesQuery.isLoading]
  );

  const queryErrorState = useMemo(
    () => ({
      workspaces: workspacesQuery.error?.message || null,
      currentWorkspace: currentWorkspaceQuery.error?.message || null,
      nodes: graphQuery.error?.message || null,
      graph: graphQuery.error?.message || null,
      nodeData: nodeDataQuery.error?.message || null,
    }),
    [currentWorkspaceQuery.error, graphQuery.error, nodeDataQuery.error, workspacesQuery.error]
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
    getNodeShape,
    queryLoadingState,
    queryErrorState,
    currentWorkspaceIdFromQuery: currentWorkspaceQuery.data,
    currentWorkspaceQueryError: currentWorkspaceQuery.isError,
  } as const;
};
