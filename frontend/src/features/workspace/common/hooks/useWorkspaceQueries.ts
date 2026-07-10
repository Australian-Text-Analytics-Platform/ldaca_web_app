import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getMyCurrentWorkspace,
  getWorkspaceGraphById,
  listWorkspaces,
} from '@/api';
import { queryKeys } from '@/lib/queryKeys';
import type { WorkspaceGraphNode as GraphNode } from '@/api';

interface WorkspaceQueriesParams {
  isAuthenticated: boolean;
  currentWorkspaceId: string | null;
  activeNodeId: string | null;
  selectedNodeIds: string[];
}

/**
 * Owns all workspace React Query reads. `useWorkspaceInternal` consumes this
 * hook to keep workspace lists, graph data, and active/selected node
 * projections together. Data View owns the selected node-page query.
 * Used by: `useWorkspaceInternal`, which needs one query bundle for provider
 * data/status slices and active-node projection.
 * Flow: auth headers and the current workspace id feed TanStack queries for
 * workspace bootstrap and graph data, then active/selected nodes are projected
 * from that graph response.
 */
export const useWorkspaceQueries = ({
  isAuthenticated,
  currentWorkspaceId,
  activeNodeId,
  selectedNodeIds,
}: WorkspaceQueriesParams) => {
  const workspacesQuery = useQuery({
    queryKey: queryKeys.workspaces,
    /**
     * Loads workspace summaries for selectors and launch screens.
     * Called by: useQuery option object inside useWorkspaceQueries.
     * Why: because each query option needs the shared auth, cache key, and enablement rules for the active workspace.
     */
    queryFn: async () => {
      const { data } = await listWorkspaces({ throwOnError: true });
      return data;
    },
    enabled: isAuthenticated,
    staleTime: 5 * 60 * 1000,
  });

  const currentWorkspaceQuery = useQuery({
    queryKey: queryKeys.currentWorkspace,
    /**
     * Restores the backend-selected workspace during authenticated startup.
     * Called by: useQuery option object inside useWorkspaceQueries.
     * Why: because each query option needs the shared auth, cache key, and enablement rules for the active workspace.
     */
    queryFn: async () => {
      const { data } = await getMyCurrentWorkspace({ throwOnError: true });
      return data.id ?? null;
    },
    enabled: isAuthenticated,
    staleTime: 60 * 1000,
  });

  const graphQuery = useQuery({
    queryKey: currentWorkspaceId
      ? queryKeys.workspaceGraph(currentWorkspaceId)
      : ['workspaces', 'graph'],
    /**
     * Fetches graph topology for the active workspace view.
     * Called by: useQuery option object inside useWorkspaceQueries.
     * Why: because each query option needs the shared auth, cache key, and enablement rules for the active workspace.
     */
    queryFn: async () => {
      if (!currentWorkspaceId) throw new Error('Missing workspace ID');
      const { data } = await getWorkspaceGraphById({
        path: { workspace_id: currentWorkspaceId },
        throwOnError: true,
      });
      return data;
    },
    enabled: isAuthenticated && !!currentWorkspaceId,
    refetchOnWindowFocus: false,
    staleTime: 30 * 1000,
  });

  const workspaces = workspacesQuery.data ?? [];
  const currentWorkspace =
    workspaces.find((workspace) => workspace.id === currentWorkspaceId) ?? null;
  const workspaceGraph = graphQuery.data ?? null;

  const nodes = workspaceGraph?.nodes ?? [];
  const selectedNode = nodes.find((node) => node.id === activeNodeId) ?? null;

  const selectedNodes = selectedNodeIds
    .map((id: string) => nodes.find((node) => node.id === id))
    .filter((n): n is GraphNode => Boolean(n));

  const queryLoadingState = useMemo(
    () => ({
      workspaces: workspacesQuery.isLoading,
      currentWorkspace: currentWorkspaceQuery.isLoading,
      nodes: graphQuery.isLoading,
      graph: graphQuery.isLoading,
    }),
    [
      workspacesQuery.isLoading,
      currentWorkspaceQuery.isLoading,
      graphQuery.isLoading,
    ],
  );

  return {
    workspacesQuery,
    currentWorkspaceQuery,
    graphQuery,
    workspaces,
    currentWorkspace,
    workspaceGraph,
    nodes,
    selectedNode,
    selectedNodes,
    queryLoadingState,
    currentWorkspaceIdFromQuery: currentWorkspaceQuery.data,
    currentWorkspaceQueryError: currentWorkspaceQuery.isError,
  } as const;
};
