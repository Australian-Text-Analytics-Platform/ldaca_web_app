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
import type { WorkspaceNodeInfo as NodeInfoResponse } from '@/api';
import { queryKeys } from './queryKeys';

export type NodeInfo = NodeInfoResponse;

interface WorkspaceQueryArgs {
  workspaceId: string;
}

type HeadersArgs = WorkspaceQueryArgs & {
  headers: Record<string, string>;
  getAuthHeaders?: never;
};

type AuthProviderArgs = WorkspaceQueryArgs & {
  headers?: never;
  getAuthHeaders: () => Record<string, string>;
};

/**
 * Either an explicit headers snapshot or an auth provider — never both.
 * Mirrors the original `nodeInfoCache` discriminated union.
 */
type HeaderProviderArgs = HeadersArgs | AuthProviderArgs;

export type NodeInfoQueryArgs = HeaderProviderArgs & {
  nodeId: string;
};

export type NodeInfosQueryArgs = HeaderProviderArgs & {
  nodeIds: string[];
};

/** Resolves auth once a query actually executes so refetches see current credentials. */
/** Called by: nodeInfoQueryOptions and fetchNodeInfo in this library module because the library needs this local step to isolate browser, data, or runtime edge cases for importers. */
const resolveHeaders = (args: HeaderProviderArgs): Record<string, string> =>
  'headers' in args && args.headers ? args.headers : args.getAuthHeaders();

/** Removes duplicate/empty ids before constructing request bodies and cache keys. */
/** Called by: nodeInfo query helpers because callers may derive ids from repeated tab inputs or selections. */
const normalizeNodeIds = (nodeIds: string[]): string[] =>
  Array.from(new Set(nodeIds.filter((nodeId) => nodeId.length > 0)));

/**
 * Fetches node-info payloads through the collection endpoint.
 * Why: single-node and batch metadata reads share one API source of truth.
 */
const requestNodeInfos = async (args: NodeInfosQueryArgs): Promise<NodeInfo[]> => {
  const nodeIds = normalizeNodeIds(args.nodeIds);
  if (nodeIds.length === 0) return [];
  const { data } = await getWorkspaceNodesInfoById({
    headers: resolveHeaders(args),
    path: { workspace_id: args.workspaceId },
    body: { nodes: nodeIds },
    throwOnError: true,
  });
  return data.nodes;
};

/**
 * Build the `useQuery` options for a (workspace, node) pair.
 * Headers are resolved lazily inside `queryFn` so the latest auth is
 * picked up on each refetch.
 */
/** Used by: schema and hydration hooks because they need one shared node-info query shape. */
export const nodeInfoQueryOptions = (args: NodeInfoQueryArgs) => ({
  queryKey: queryKeys.nodeInfo(args.workspaceId, args.nodeId),
  /**
   * Fetches fresh node metadata for query consumers while resolving auth at execution time.
   * Why: importers need one shared normalization boundary to keep behavior consistent.
   */
  queryFn: async (): Promise<NodeInfo> => {
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
 * Headers are resolved lazily inside `queryFn` so the latest auth is
 * picked up on each refetch.
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
    queryFn: async (): Promise<NodeInfo[]> => requestNodeInfos({ ...args, nodeIds }),
  };
};

export interface FetchNodeInfoArgs {
  queryClient: QueryClient;
  workspaceId: string;
  nodeId: string;
  /** When true, drop any cached value first so the next read re-fetches. */
  force?: boolean;
  headers?: Record<string, string>;
  getAuthHeaders?: () => Record<string, string>;
}

export interface FetchNodeInfosArgs {
  queryClient: QueryClient;
  workspaceId: string;
  nodeIds: string[];
  /** When true, drop cached values first so the next read re-fetches. */
  force?: boolean;
  headers?: Record<string, string>;
  getAuthHeaders?: () => Record<string, string>;
}

/**
 * Non-hook fetcher used by mutation success handlers, hydration callbacks,
 * and other async work outside React's render tree. Returns the cached
 * value when present and fresh; otherwise runs the collection node-info
 * request once and caches the result for future hook subscriptions.
 * Why: importers need one shared normalization boundary to keep behavior consistent.
 * Flow: optionally remove the cached node entry, build headers or auth-provider query args, then fetch through TanStack Query.
 */
export const fetchNodeInfo = async ({
  queryClient,
  workspaceId,
  nodeId,
  force,
  headers,
  getAuthHeaders,
}: FetchNodeInfoArgs): Promise<NodeInfo> => {
  if (force) {
    queryClient.removeQueries({ queryKey: queryKeys.nodeInfo(workspaceId, nodeId) });
  }
  const queryArgs: NodeInfoQueryArgs = headers
    ? { workspaceId, nodeId, headers }
    : { workspaceId, nodeId, getAuthHeaders: getAuthHeaders ?? (() => ({})) };
  return queryClient.fetchQuery(nodeInfoQueryOptions(queryArgs));
};

/**
 * Non-hook batch fetcher for workflows that need metadata snapshots for
 * several nodes. The batch query is cached as a unit, and each returned node
 * also refreshes its single-node cache entry.
 */
/** Used by: analysis snapshot builders because multi-node tasks should fetch schema metadata in one request. */
export const fetchNodeInfos = async ({
  queryClient,
  workspaceId,
  nodeIds,
  force,
  headers,
  getAuthHeaders,
}: FetchNodeInfosArgs): Promise<NodeInfo[]> => {
  const normalizedNodeIds = normalizeNodeIds(nodeIds);
  if (normalizedNodeIds.length === 0) return [];
  if (force) {
    queryClient.removeQueries({ queryKey: queryKeys.nodeInfos(workspaceId, normalizedNodeIds) });
    normalizedNodeIds.forEach((nodeId) => {
      queryClient.removeQueries({ queryKey: queryKeys.nodeInfo(workspaceId, nodeId) });
    });
  }
  const queryArgs: NodeInfosQueryArgs = headers
    ? { workspaceId, nodeIds: normalizedNodeIds, headers }
    : {
        workspaceId,
        nodeIds: normalizedNodeIds,
        getAuthHeaders: getAuthHeaders ?? (() => ({})),
      };
  const nodeInfos = await queryClient.fetchQuery(nodeInfosQueryOptions(queryArgs));
  nodeInfos.forEach((nodeInfo) => {
    queryClient.setQueryData<NodeInfo>(queryKeys.nodeInfo(workspaceId, nodeInfo.id), nodeInfo);
  });
  return nodeInfos;
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
        key[3] === 'info' &&
        key[4] === 'batch' &&
        (!nodeId || key.slice(5).includes(nodeId));
      return singleNodeInfoKey || batchNodeInfoKey;
    },
  });
};
