import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { invalidateNodeInfoQuery } from '@/lib/nodeInfo';
import { invalidateNodeSchemaQuery } from '@/lib/nodeSchema';
import { queryKeys } from '@/lib/queryKeys';

export interface NodeCacheInvalidationOptions {
  includeNodeInfo?: boolean;
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
  void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
};

/**
 * Invalidates node-level data/info caches alongside the owning graph.
 * Used by: workspace mutation success handlers for operations that can rewrite
 * a node's table data, schema, or cached node-info metadata.
 * Flow: skip when no workspace/node id is available, optionally clear the
 * node-info query, then invalidate graph/data queries requested by the caller.
 */
export const invalidateNodeWorkspaceQueries = (
  queryClient: QueryClient,
  workspaceId: string | null | undefined,
  nodeId: string | null | undefined,
  options: NodeCacheInvalidationOptions = {},
) => {
  if (!workspaceId || !nodeId) return;
  if (options.includeNodeInfo) {
    invalidateNodeInfoQuery(queryClient, workspaceId, nodeId);
  }
  if (options.includeSchema) {
    invalidateNodeSchemaQuery(queryClient, workspaceId, nodeId);
  }
  invalidateWorkspaceGraphQuery(queryClient, workspaceId);
  if (options.includeData) {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.nodeData(workspaceId, nodeId),
    });
  }
};
