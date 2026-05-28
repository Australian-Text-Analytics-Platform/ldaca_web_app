/**
 * react-query-backed accessors for node info (`GET /workspaces/nodes/:id`).
 *
 * Replaces the standalone `Map`-based `nodeInfoCache.ts` — caching, request
 * deduplication, and invalidation are delegated to TanStack Query so a
 * single client owns every cache slot. Three entry points cover the three
 * call patterns:
 *
 *   - `nodeInfoQueryOptions({ workspaceId, nodeId, ... })` — pass to
 *     `useQuery` / `useQueries` for hook-context subscriptions.
 *   - `fetchNodeInfo({ queryClient, ... })` — non-hook helper backed by
 *     `queryClient.fetchQuery`. Built-in inflight dedup + cache reuse.
 *   - `invalidateNodeInfoQuery(queryClient, workspaceId, nodeId?)` —
 *     drop one node's entry, or every entry under a workspace.
 */
import type { QueryClient } from '@tanstack/react-query';

import { getNodeInfo } from '@/api/generated/sdk.gen';
import type { WorkspaceNodeInfo as NodeInfoResponse } from '@/api/generated/types.gen';
import { queryKeys } from './queryKeys';

export type NodeInfo = NodeInfoResponse;

type BaseQueryArgs = {
  workspaceId: string;
  nodeId: string;
};

type HeadersArgs = BaseQueryArgs & {
  headers: Record<string, string>;
  getAuthHeaders?: never;
};

type AuthProviderArgs = BaseQueryArgs & {
  headers?: never;
  getAuthHeaders: () => Record<string, string>;
};

/**
 * Either an explicit headers snapshot or an auth provider — never both.
 * Mirrors the original `nodeInfoCache` discriminated union.
 */
export type NodeInfoQueryArgs = HeadersArgs | AuthProviderArgs;

/** Resolves auth once a query actually executes so refetches see current credentials. */
/** Called by: nodeInfoQueryOptions and fetchNodeInfo in this library module because the library needs this local step to isolate browser, data, or runtime edge cases for importers. */
const resolveHeaders = (args: NodeInfoQueryArgs): Record<string, string> =>
  'headers' in args && args.headers ? args.headers : args.getAuthHeaders();

/**
 * Build the `useQuery` / `useQueries` options for a (workspace, node) pair.
 * Headers are resolved lazily inside `queryFn` so the latest auth is
 * picked up on each refetch.
 */
/** Used by: src/hooks/useNodeColumnInfos.ts because the library needs this local step to isolate browser, data, or runtime edge cases for importers. */
export const nodeInfoQueryOptions = (args: NodeInfoQueryArgs) => ({
  queryKey: queryKeys.nodeInfo(args.workspaceId, args.nodeId),
  /**
   * Fetches fresh node metadata for query consumers while resolving auth at execution time.
   * Why: importers need one shared normalization boundary to keep behavior consistent.
   */
  queryFn: async (): Promise<NodeInfo> => {
    const { data } = await getNodeInfo({
      headers: resolveHeaders(args),
      path: { node_id: args.nodeId },
      throwOnError: true,
    });
    return data;
  },
});

export type FetchNodeInfoArgs = {
  queryClient: QueryClient;
  workspaceId: string;
  nodeId: string;
  /** When true, drop any cached value first so the next read re-fetches. */
  force?: boolean;
  headers?: Record<string, string>;
  getAuthHeaders?: () => Record<string, string>;
};

/**
 * Non-hook fetcher used by mutation success handlers, hydration callbacks,
 * and other async work outside React's render tree. Returns the cached
 * value when present (and fresh); otherwise runs `getNodeInfo` once,
 * caching the result for future hook subscriptions.
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
  if (nodeId) {
    queryClient.invalidateQueries({ queryKey: queryKeys.nodeInfo(workspaceId, nodeId) });
    return;
  }
  queryClient.invalidateQueries({
    /** Limits broad invalidation to node-info records under the requested workspace. */
    /** Called by: TanStack Query cache invalidation filtering because query callers need stable cache keys, fetchers, and invalidation targets for the request lifecycle. */
    predicate: (query) => {
      const key = query.queryKey;
      return (
        Array.isArray(key)
        && key[0] === 'workspaces'
        && key[1] === workspaceId
        && key[2] === 'nodes'
        && key[4] === 'info'
      );
    },
  });
};
