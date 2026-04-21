/**
 * Process-wide cache for node metadata (`GET /workspaces/:ws/nodes/:node`).
 *
 * Backend node info can be expensive (column schema, statistics). Multiple
 * hooks ask for the same `(workspaceId, nodeId)` on a single render pass, so
 * we deduplicate:
 *   - `cache`    — resolved infos, returned synchronously on hit.
 *   - `inflight` — in-progress fetches, so concurrent callers share one request.
 *
 * Consumers call `invalidateNodeInfo` (optionally node-scoped) after any
 * mutation that changes a node's shape/schema.
 */
import { nodesApi } from '../api/nodes';

export interface NodeInfo {
  name?: string;
  data?: Record<string, unknown> & {
    name?: string;
    columns?: string[];
  };
  columns?: string[];
  schema?: unknown;
  [key: string]: unknown;
}

interface BaseOptions {
  workspaceId: string;
  nodeId: string;
  /** Bypass the cached value and refetch. Inflight requests are still shared. */
  force?: boolean;
}

interface HeadersOptions extends BaseOptions {
  headers: Record<string, string>;
  getAuthHeaders?: never;
}

interface AuthProviderOptions extends BaseOptions {
  headers?: never;
  getAuthHeaders: () => Record<string, string>;
}

export type NodeInfoRequestOptions = HeadersOptions | AuthProviderOptions;

const cache = new Map<string, NodeInfo>();
const inflight = new Map<string, Promise<NodeInfo>>();

const cacheKeyFor = (workspaceId: string, nodeId: string) => `${workspaceId}::${nodeId}`;

const resolveHeaders = (options: NodeInfoRequestOptions): Record<string, string> =>
  'headers' in options && options.headers ? options.headers : options.getAuthHeaders();

export async function getNodeInfo(options: NodeInfoRequestOptions): Promise<NodeInfo> {
  const { workspaceId, nodeId, force = false } = options;
  const key = cacheKeyFor(workspaceId, nodeId);

  if (!force) {
    const cached = cache.get(key);
    if (cached) return cached;
  } else {
    cache.delete(key);
  }

  // Share an in-flight request even across force=true callers to avoid stampedes.
  const pending = inflight.get(key);
  if (pending) return pending;

  const request = nodesApi
    .info(nodeId, resolveHeaders(options))
    .then((info) => {
      const typed = info as unknown as NodeInfo;
      cache.set(key, typed);
      return typed;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, request);
  return request;
}

/**
 * Drop cached entries for a workspace (all nodes) or a specific node. Any
 * concurrent inflight request is also cancelled from the cache's perspective,
 * so the next call re-fetches.
 */
export function invalidateNodeInfo(workspaceId: string, nodeId?: string): void {
  if (nodeId) {
    const key = cacheKeyFor(workspaceId, nodeId);
    cache.delete(key);
    inflight.delete(key);
    return;
  }
  const prefix = `${workspaceId}::`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
  for (const key of inflight.keys()) {
    if (key.startsWith(prefix)) inflight.delete(key);
  }
}


