/**
 * react-query-backed accessors for node info (`POST /workspaces/{workspace_id}/nodes:batchGet`).
 *
 * Replaces the standalone `Map`-based `nodeInfoCache.ts` — caching, request
 * deduplication, and invalidation are delegated to TanStack Query so a
 * single client owns every cache slot. These entry points cover the common
 * call patterns:
 *
 *   - `nodeInfosQueryOptions({ workspaceId, nodeIds, ... })` — pass to
 *     `useQuery` for batched hook-context subscriptions.
 *   - `invalidateNodeInfoQuery(queryClient, workspaceId, nodeId?)` —
 *     drop one node's entry, or every entry under a workspace.
 */
import type { QueryClient } from '@tanstack/react-query';

import { getNode } from '@/api';
import type { WorkspaceNodeInfo } from '@/api';
import { queryKeys } from './queryKeys';

interface WorkspaceQueryArgs {
  workspaceId: string;
}

type NodeInfosQueryArgs = WorkspaceQueryArgs & {
  nodeIds: string[];
};

/** Removes duplicate/empty ids before constructing request bodies and cache keys. */
/** Called by: nodeInfo query helpers because callers may derive ids from repeated tab inputs or selections. */
const normalizeNodeIds = (nodeIds: string[]): string[] =>
  Array.from(new Set(nodeIds.filter((nodeId) => nodeId.length > 0)));

/**
 * Fetches node-info payloads through the collection endpoint.
 * Why: single-node and batch metadata reads share one API source of truth.
 */
const requestNodeInfos = async (args: NodeInfosQueryArgs): Promise<WorkspaceNodeInfo[]> => {
  const nodeIds = normalizeNodeIds(args.nodeIds);
  if (nodeIds.length === 0) return [];
  const values = await Promise.all(
    nodeIds.map(async (nodeId) => {
      const { data } = await getNode({
        path: { workspace_id: args.workspaceId, node_id: nodeId },
        throwOnError: true,
      });
      return data;
    }),
  );
  return values;
};

/**
 * Build the `useQuery` options for a batch of workspace nodes.
 * Generated client configuration resolves auth for each request.
 */
/** Used by: useNodeColumnInfos because batched selectors need one request for all selected nodes. */
export const nodeInfosQueryOptions = (args: NodeInfosQueryArgs) => {
  const nodeIds = normalizeNodeIds(args.nodeIds);
  return {
    queryKey: queryKeys.nodeInfos(args.workspaceId, nodeIds),
    /**
     * Fetches fresh node metadata for a selected-node batch.
     * Why: selectors should not fan out one schema request per selected node.
     */
    queryFn: async (): Promise<WorkspaceNodeInfo[]> => requestNodeInfos({ ...args, nodeIds }),
  };
};

/**
 * Invalidate batched node-info queries under a Workspace.
 */
/**
 * Used by: `workspaceMutationCache` and `usePersistNodeDocumentColumn` after
 * mutations that make cached node metadata stale.
 * Flow: invalidate one node-info key when provided, otherwise predicate-match every node-info query under the workspace.
 */
export const invalidateNodeInfoQuery = (
  queryClient: QueryClient,
  workspaceId: string,
  nodeId?: string,
): void => {
  void queryClient.invalidateQueries({
    /** Limits invalidation to batched node-info records containing the edited Data Block. */
    /** Called by: TanStack Query cache invalidation filtering. */
    predicate: (query) => {
      const key = query.queryKey;
      if (
        !Array.isArray(key) ||
        key[0] !== 'workspaces' ||
        key[1] !== workspaceId ||
        key[2] !== 'nodes'
      ) {
        return false;
      }
      const batchNodeInfoKey =
        key[3] === 'info' && key[4] === 'batch' && (!nodeId || key.slice(5).includes(nodeId));
      return batchNodeInfoKey;
    },
  });
};
