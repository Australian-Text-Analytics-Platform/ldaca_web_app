import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/hooks/useAuth';
import {
  type ColumnInfo,
  mapColumnsToInfo,
} from '@/features/workspace/data-view/utils/columnTypes';
import { type NodeInfo, nodeInfosQueryOptions } from '@/lib/nodeInfo';

export type NodeLike = Record<string, unknown> & {
  id: string;
};

/** Resolves the backend node id from a live workspace node. */
/** Called by: useNodeColumnInfos in this hook module because the hook needs local steps to normalize inputs before exposing stable state to consumers. */
const resolveNodeId = (node: NodeLike | null | undefined): string | null => node?.id ?? null;

export interface UseNodeColumnInfosResult {
  columnInfoCache: Record<string, ColumnInfo[]>;
  /** Full node-info responses keyed by node id for metadata beyond columns. */
  nodeInfoCache: Record<string, NodeInfo>;
  /**
   * Returns cached column infos for the provided node. Falls back to any dtype
   * evidence already present on the node snapshot; graph-only nodes usually
   * have no column metadata until node-info has hydrated.
   */
  getColumnInfos: (node: NodeLike | null | undefined) => ColumnInfo[];
  /** Returns the cached node-info response for consumers that need shape or tokenizer metadata. */
  getNodeInfo: (node: NodeLike | null | undefined) => NodeInfo | undefined;
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
 * Flow: resolve live node ids, issue one batch node-info query, build typed metadata caches, then return cached getters and loading flag.
 */
export const useNodeColumnInfos = (params: {
  workspaceId?: string | null;
  nodes: NodeLike[];
  enabled?: boolean;
}): UseNodeColumnInfosResult => {
  const { workspaceId, nodes, enabled = true } = params;
  const { getAuthHeaders } = useAuth();

  const nodeIds = nodes
    .map((node) => resolveNodeId(node))
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
  const getColumnInfos = (node: NodeLike | null | undefined): ColumnInfo[] => {
    const nodeId = resolveNodeId(node);
    if (!nodeId) return [];
    const cached = columnInfoCache[nodeId];
    if (cached?.length) {
      return cached;
    }
    return mapColumnsToInfo(node);
  };

  /** Returns cached node metadata for consumers that need full node-info fields. */
  /** Called by: useNodeColumnInfos in this hook module because the hook needs local steps to normalize inputs before exposing stable state to consumers. */
  const getNodeInfo = (node: NodeLike | null | undefined): NodeInfo | undefined => {
    const nodeId = resolveNodeId(node);
    return nodeId ? nodeInfoCache[nodeId] : undefined;
  };

  const isLoading = nodeInfosQuery.isFetching;

  return { columnInfoCache, nodeInfoCache, getColumnInfos, getNodeInfo, isLoading };
};
