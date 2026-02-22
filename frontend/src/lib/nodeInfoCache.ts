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

const resolveHeaders = (options: NodeInfoRequestOptions): Record<string, string> => {
  if ('headers' in options && options.headers) {
    return options.headers;
  }
  if ('getAuthHeaders' in options && options.getAuthHeaders) {
    return options.getAuthHeaders();
  }
  throw new Error('Either headers or getAuthHeaders must be provided to fetch node info.');
};

const finalize = (key: string, info: NodeInfo) => {
  cache.set(key, info);
  inflight.delete(key);
  return info;
};

const handleFailure = (key: string, error: unknown) => {
  inflight.delete(key);
  throw error;
};

export async function getNodeInfo(options: NodeInfoRequestOptions): Promise<NodeInfo> {
  const { workspaceId, nodeId, force = false } = options;
  const key = cacheKeyFor(workspaceId, nodeId);

  if (!force) {
    const cached = cache.get(key);
    if (cached) {
      return cached;
    }
    const pending = inflight.get(key);
    if (pending) {
      return pending;
    }
  } else {
    cache.delete(key);
    const pending = inflight.get(key);
    if (pending) {
      return pending;
    }
  }

  const headers = resolveHeaders(options);
  const request = nodesApi
    .info(nodeId, headers)
    .then((info) => finalize(key, info))
    .catch((error) => handleFailure(key, error));

  inflight.set(key, request);
  return request;
}

export function primeNodeInfo(workspaceId: string, nodeId: string, info: NodeInfo): void {
  const key = cacheKeyFor(workspaceId, nodeId);
  cache.set(key, info);
}

export function invalidateNodeInfo(workspaceId: string, nodeId?: string): void {
  if (nodeId) {
    const key = cacheKeyFor(workspaceId, nodeId);
    cache.delete(key);
    inflight.delete(key);
    return;
  }
  const prefix = `${workspaceId}::`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
  for (const key of inflight.keys()) {
    if (key.startsWith(prefix)) {
      inflight.delete(key);
    }
  }
}

export function getCachedNodeInfo(workspaceId: string, nodeId: string): NodeInfo | undefined {
  return cache.get(cacheKeyFor(workspaceId, nodeId));
}
