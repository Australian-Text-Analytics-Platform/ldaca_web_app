/**
 * react-query-backed accessors for node info (`POST /workspaces/{workspace_id}/nodes:batchGet`).
 *
 * Replaces the standalone `Map`-based `nodeInfoCache.ts` — caching, request
 * deduplication, and invalidation are delegated to TanStack Query so a
 * single client owns every cache slot. These entry points cover the common
 * call patterns:
 *
 *   - `nodeInfoQueryOptions({ workspaceId, nodeId, ... })` — pass to
 *     `useQuery` for single-node hook-context subscriptions.
 *   - `nodeInfosQueryOptions({ workspaceId, nodeIds, ... })` — pass to
 *     `useQuery` for batched hook-context subscriptions.
 *   - `fetchNodeInfo({ queryClient, ... })` — non-hook helper backed by
 *     `queryClient.fetchQuery`. Built-in inflight dedup + cache reuse.
 *   - `invalidateNodeInfoQuery(queryClient, workspaceId, nodeId?)` —
 *     drop one node's entry, or every entry under a workspace.
 */
import type { QueryClient } from '@tanstack/react-query';

import { getWorkspaceNodesInfoById } from '@/api';
import type { WorkspaceNodeInfo } from '@/api';
import { queryKeys } from './queryKeys';

interface WorkspaceQueryArgs {
  workspaceId: string;
}

type NodeInfoQueryArgs = WorkspaceQueryArgs & {
  nodeId: string;
};

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
  const { data } = await getWorkspaceNodesInfoById({
    path: { workspace_id: args.workspaceId },
    body: { nodes: nodeIds },
    throwOnError: true,
  });
  return data.nodes;
};

/**
 * Build the `useQuery` options for a (workspace, node) pair.
 * Generated client configuration resolves auth for each request.
 */
/** Used by: schema and hydration hooks because they need one shared node-info query shape. */
export const nodeInfoQueryOptions = (args: NodeInfoQueryArgs) => ({
  queryKey: queryKeys.nodeInfo(args.workspaceId, args.nodeId),
  /**
   * Fetches fresh node metadata for query consumers while resolving auth at execution time.
   * Why: importers need one shared normalization boundary to keep behavior consistent.
   */
  queryFn: async (): Promise<WorkspaceNodeInfo> => {
    const nodeInfos = await requestNodeInfos({
      ...args,
      nodeIds: [args.nodeId],
    });
    const nodeInfo = nodeInfos[0];
    if (!nodeInfo) {
      throw new Error(`Node info response did not include ${args.nodeId}`);
    }
    return nodeInfo;
  },
});

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

interface FetchNodeInfoArgs {
  queryClient: QueryClient;
  workspaceId: string;
  nodeId: string;
  /** When true, drop any cached value first so the next read re-fetches. */
  force?: boolean;
}

/**
 * Non-hook fetcher used by mutation success handlers, hydration callbacks,
 * and other async work outside React's render tree. Returns the cached
 * value when present and fresh; otherwise runs the collection node-info
 * request once and caches the result for future hook subscriptions.
 * Why: importers need one shared normalization boundary to keep behavior consistent.
 * Flow: optionally remove the cached node entry, build the canonical query options, then fetch through TanStack Query; generated-client configuration owns request auth.
 */
export const fetchNodeInfo = async ({
  queryClient,
  workspaceId,
  nodeId,
  force,
}: FetchNodeInfoArgs): Promise<WorkspaceNodeInfo> => {
  if (force) {
    queryClient.removeQueries({ queryKey: queryKeys.nodeInfo(workspaceId, nodeId) });
  }
  return queryClient.fetchQuery(nodeInfoQueryOptions({ workspaceId, nodeId }));
};

/**
 * Invalidate the `nodeInfo` query (or every node-info query under a
 * workspace when `nodeId` is omitted). Mirrors the previous
 * `invalidateNodeInfo` API.
 */
/**
 * Used by: src/features/workspace/common/hooks/useWorkspaceNodeMutations.ts because the library needs this local step to isolate browser, data, or runtime edge cases for importers.
 * Flow: invalidate one node-info key when provided, otherwise predicate-match every node-info query under the workspace.
 */
export const invalidateNodeInfoQuery = (
  queryClient: QueryClient,
  workspaceId: string,
  nodeId?: string,
): void => {
  void queryClient.invalidateQueries({
    /** Limits broad invalidation to single and batched node-info records under the requested workspace. */
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
      const singleNodeInfoKey = key[4] === 'info' && (!nodeId || key[3] === nodeId);
      const batchNodeInfoKey =
        key[3] === 'info' && key[4] === 'batch' && (!nodeId || key.slice(5).includes(nodeId));
      return singleNodeInfoKey || batchNodeInfoKey;
    },
  });
};
