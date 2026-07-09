import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/hooks/useAuth';
import {
  type ColumnInfo,
  mapColumnsToInfo,
} from '@/features/workspace/data-view/utils/columnTypes';
import { type NodeInfo, nodeInfosQueryOptions } from '@/lib/nodeInfo';

export type NodeLike = Record<string, unknown> & {
  id?: string;
  node_id?: string;
  data?: Record<string, unknown> & {
    id?: string;
    node_id?: string;
  };
  unique_id?: string;
};

/** Resolves the backend node id from graph, table, or legacy node payload shapes. */
/** Called by: useNodeColumnInfos in this hook module because the hook needs local steps to normalize inputs before exposing stable state to consumers. */
const resolveNodeId = (node: NodeLike | null | undefined, fallbackIndex: number): string | null => {
  if (!node) return null;
  const candidates = [node.id, node.node_id, node.data?.id, node.data?.node_id, node.unique_id];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length) {
      return candidate;
    }
  }
  return `node-${String(fallbackIndex)}`;
};

export interface UseNodeColumnInfosResult {
  columnInfoCache: Record<string, ColumnInfo[]>;
  /** Full node-info responses keyed by node id for metadata beyond columns. */
  nodeInfoCache: Record<string, NodeInfo>;
  /**
   * Returns cached column infos for the provided node. Falls back to basic
   * mapping if the cache has not been hydrated yet, ensuring the selector
   * always renders something while the typed schema is loading.
   */
  getColumnInfos: (node: NodeLike | null | undefined, idx?: number) => ColumnInfo[];
  /** Returns the cached node-info response for consumers that need shape or tokenizer metadata. */
  getNodeInfo: (node: NodeLike | null | undefined, idx?: number) => NodeInfo | undefined;
  /** True while one or more schemas are being fetched. */
  isLoading: boolean;
}

/**
 * Fetch typed column info for a set of workspace nodes. Backed by
 * one batched node-info query — request dedup, caching, and invalidation flow
 * through the TanStack client used everywhere else in the app.
 */
/**
 * Used by: add-node-as-needed input hooks and analysis feature screens because the hook needs local steps to normalize inputs before exposing stable state to consumers.
 * Flow: resolve node ids, issue one batch node-info query, build typed metadata caches, then return fallback-aware getters and loading flag.
 */
export const useNodeColumnInfos = (params: {
  workspaceId?: string | null;
  nodes: NodeLike[];
  enabled?: boolean;
}): UseNodeColumnInfosResult => {
  const { workspaceId, nodes, enabled = true } = params;
  const { getAuthHeaders } = useAuth();

  const nodeIds = nodes
    .map((node, idx) => resolveNodeId(node, idx))
    .filter((id): id is string => !!id);

  const queryEnabled = enabled && Boolean(workspaceId) && nodeIds.length > 0;
  const nodeInfosQuery = useQuery({
    ...nodeInfosQueryOptions({ workspaceId: workspaceId ?? '', nodeIds, getAuthHeaders }),
    enabled: queryEnabled,
    staleTime: 60_000,
  });

  const nodeInfoCache: Record<string, NodeInfo> = {};
  for (const nodeInfo of nodeInfosQuery.data ?? []) {
    nodeInfoCache[nodeInfo.id] = nodeInfo;
  }

  const columnInfoCache: Record<string, ColumnInfo[]> = {};
  nodeIds.forEach((nodeId) => {
    const data = nodeInfoCache[nodeId];
    if (data) {
      columnInfoCache[nodeId] = mapColumnsToInfo(data);
    }
  });

  /** Returns typed cached columns when available, otherwise derives from the node snapshot. */
  /** Called by: useNodeColumnInfos in this hook module because the hook needs local steps to normalize inputs before exposing stable state to consumers. */
  const getColumnInfos = (node: NodeLike | null | undefined, idx = 0): ColumnInfo[] => {
    const nodeId = resolveNodeId(node, idx);
    if (!nodeId) return [];
    const cached = columnInfoCache[nodeId];
    if (cached?.length) {
      return cached;
    }
    return mapColumnsToInfo(node);
  };

  /** Returns cached node metadata for consumers that need full node-info fields. */
  /** Called by: useNodeColumnInfos in this hook module because the hook needs local steps to normalize inputs before exposing stable state to consumers. */
  const getNodeInfo = (node: NodeLike | null | undefined, idx = 0): NodeInfo | undefined => {
    const nodeId = resolveNodeId(node, idx);
    return nodeId ? nodeInfoCache[nodeId] : undefined;
  };

  const isLoading = nodeInfosQuery.isFetching;

  return { columnInfoCache, nodeInfoCache, getColumnInfos, getNodeInfo, isLoading };
};
