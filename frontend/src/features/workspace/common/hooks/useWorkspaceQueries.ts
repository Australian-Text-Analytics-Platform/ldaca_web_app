import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listNodes, listWorkspaces } from '@/api';
import type { WorkspaceGraphResponse } from '@/api';
import { queryKeys } from '@/lib/queryKeys';
import type { WorkspaceNodeInfo as GraphNode } from '@/api';

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
 * Flow: authenticated readiness gates workspace bootstrap reads, the current
 * workspace id selects the graph query, and active/selected nodes are projected
 * from that graph response. Generated-client configuration owns request auth.
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
     * Why: the list must wait for authenticated readiness and share one canonical cache key.
     */
    queryFn: async () => {
      const { data } = await listWorkspaces({ throwOnError: true });
      return data;
    },
    enabled: isAuthenticated,
    staleTime: 5 * 60 * 1000,
  });

  const nodesQuery = useQuery({
    queryKey: currentWorkspaceId
      ? queryKeys.workspaceGraph(currentWorkspaceId)
      : ['workspaces', 'graph'],
    /**
     * Fetches graph topology for the active workspace view.
     * Why: graph consumers need one cache entry gated by authenticated workspace identity.
     */
    queryFn: async () => {
      if (!currentWorkspaceId) throw new Error('Missing workspace ID');
      const { data } = await listNodes({
        path: { workspace_id: currentWorkspaceId },
        throwOnError: true,
      });
      const edges = data.flatMap((node) =>
        (node.child_ids ?? []).map((childId) => ({
          id: `${node.id}:${childId}`,
          source: node.id,
          target: childId,
        })),
      );
      return { nodes: data, edges } satisfies WorkspaceGraphResponse;
    },
    enabled: isAuthenticated && !!currentWorkspaceId,
    refetchOnWindowFocus: false,
    staleTime: 30 * 1000,
  });

  const workspaces = workspacesQuery.data ?? [];
  const currentWorkspace =
    workspaces.find((workspace) => workspace.id === currentWorkspaceId) ?? null;
  const workspaceGraph = nodesQuery.data ?? null;

  const nodes = workspaceGraph?.nodes ?? [];
  const selectedNode = nodes.find((node) => node.id === activeNodeId) ?? null;

  const selectedNodes = selectedNodeIds
    .map((id: string) => nodes.find((node) => node.id === id))
    .filter((n): n is GraphNode => Boolean(n));

  const queryLoadingState = useMemo(
    () => ({
      workspaces: workspacesQuery.isLoading,
      currentWorkspace: workspacesQuery.isLoading,
      nodes: nodesQuery.isLoading,
      graph: nodesQuery.isLoading,
    }),
    [workspacesQuery.isLoading, nodesQuery.isLoading],
  );

  return {
    workspaces,
    currentWorkspace,
    workspaceGraph,
    nodes,
    selectedNode,
    selectedNodes,
    queryLoadingState,
    currentWorkspaceIdFromQuery: currentWorkspaceId,
    currentWorkspaceQueryError: false,
  } as const;
};
