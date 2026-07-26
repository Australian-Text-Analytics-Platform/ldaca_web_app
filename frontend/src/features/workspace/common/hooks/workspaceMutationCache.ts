import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { invalidateNodeSchemaQuery } from '@/lib/nodeSchema';
import { queryKeys } from '@/lib/queryKeys';

export interface NodeCacheInvalidationOptions {
  includeData?: boolean;
  /** Invalidates the authoritative Arrow schema query. */
  includeSchema?: boolean;
}

/**
 * Identifies cached queries that belong to one workspace detail subtree.
 * Used by workspace selection changes because clearing or switching workspaces
 * should touch graph and node-detail queries without dropping the workspace list.
 */
export const isWorkspaceDetailQueryKey = (
  queryKey: QueryKey,
  workspaceId: string | null | undefined,
) =>
  Boolean(
    workspaceId &&
      Array.isArray(queryKey) &&
      queryKey[0] === 'workspaces' &&
      queryKey[1] === workspaceId &&
      queryKey.length > 1,
  );

/**
 * Invalidates graph-shaped workspace queries without forcing callers to repeat
 * the current-workspace null guard.
 * Used by: workspace mutation hooks because graph mutations share the same
 * TanStack query key and only differ in which backend operation triggered the
 * refresh.
 */
export const invalidateWorkspaceGraphQuery = (
  queryClient: QueryClient,
  workspaceId: string | null | undefined,
) => {
  if (!workspaceId) return;
  void queryClient.invalidateQueries({
    queryKey: queryKeys.workspaceGraph(workspaceId),
  });
};

/** Refreshes workspace summaries after a mutation changes metadata or node counts. */
export const invalidateWorkspaceSummaries = (queryClient: QueryClient) => {
  void queryClient.invalidateQueries({ queryKey: queryKeys.workspaceList, exact: true });
};

const queryKeyDependsOnNode = (
  queryKey: QueryKey,
  workspaceId: string,
  nodeId: string,
): boolean => {
  if (
    queryKey[0] !== 'workspaces' ||
    queryKey[1] !== workspaceId ||
    (queryKey[2] !== 'sql' && queryKey[2] !== 'preprocessing-previews')
  ) {
    return false;
  }
  const dependency = queryKey[3];
  if (typeof dependency !== 'object' || dependency === null || !('nodeIds' in dependency)) {
    return false;
  }
  const nodeIds = (dependency as { nodeIds?: unknown }).nodeIds;
  return Array.isArray(nodeIds) && nodeIds.includes(nodeId);
};

/**
 * Invalidates node-level projections alongside the owning graph.
 * Used by: workspace mutation success handlers for operations that can rewrite
 * a node's table data or schema.
 * Flow: skip when no workspace/node id is available, then invalidate the graph,
 * optional schema, and every data projection that declares the node dependency.
 */
export const invalidateNodeWorkspaceQueries = (
  queryClient: QueryClient,
  workspaceId: string | null | undefined,
  nodeId: string | null | undefined,
  options: NodeCacheInvalidationOptions = {},
) => {
  if (!workspaceId || !nodeId) return;
  if (options.includeSchema) {
    invalidateNodeSchemaQuery(queryClient, workspaceId, nodeId);
  }
  invalidateWorkspaceGraphQuery(queryClient, workspaceId);
  if (options.includeData) {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.nodeColumns(workspaceId, nodeId),
    });
    void queryClient.invalidateQueries({
      predicate: (query) => queryKeyDependsOnNode(query.queryKey, workspaceId, nodeId),
    });
  }
};
