import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import { type ColumnInfo, mapColumnsToInfo } from '../utils/columnTypes';
import { nodeInfoQueryOptions } from '../lib/nodeInfo';

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
  return `node-${fallbackIndex}`;
};

export interface UseNodeColumnInfosResult {
  columnInfoCache: Record<string, ColumnInfo[]>;
  /**
   * Returns cached column infos for the provided node. Falls back to basic
   * mapping if the cache has not been hydrated yet, ensuring the selector
   * always renders something while the typed schema is loading.
   */
  getColumnInfos: (node: NodeLike | null | undefined, idx?: number) => ColumnInfo[];
  /** True while one or more schemas are being fetched. */
  isLoading: boolean;
}

/**
 * Fetch typed column info for a set of workspace nodes. Backed by
 * `useQueries` against the shared `nodeInfo` query — request dedup,
 * caching, and invalidation flow through the TanStack client used
 * everywhere else in the app.
 */
/**
 * Used by: src/features/analysis/ai-annotator/AiAnnotatorFeature.tsx, src/features/analysis/common/useAnalysisLockMachine.ts, src/features/analysis/concordance/ConcordanceFeature.tsx and 3 other importers because the hook needs local steps to normalize inputs before exposing stable state to consumers.
 * Flow: resolve node ids, issue node-info queries, build a typed column cache, then return a fallback-aware getter and loading flag.
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

  const queryEnabled = enabled && Boolean(workspaceId);
  const results = useQueries({
    queries: nodeIds.map((nodeId) => ({
      ...nodeInfoQueryOptions({ workspaceId: workspaceId ?? '', nodeId, getAuthHeaders }),
      enabled: queryEnabled && !!nodeId && !!workspaceId,
      staleTime: 60_000,
    })),
  });

  const columnInfoCache = useMemo(() => {
    const cache: Record<string, ColumnInfo[]> = {};
    nodeIds.forEach((nodeId, idx) => {
      const data = results[idx]?.data;
      if (data) {
        cache[nodeId] = mapColumnsToInfo(data);
      }
    });
    return cache;
  }, [nodeIds, results]);

  /** Returns typed cached columns when available, otherwise derives from the node snapshot. */
  /** Called by: useNodeColumnInfos in this hook module because the hook needs local steps to normalize inputs before exposing stable state to consumers. */
  const getColumnInfos = (node: NodeLike | null | undefined, idx = 0): ColumnInfo[] => {
    const nodeId = resolveNodeId(node, idx);
    if (!nodeId) return [];
    const cached = columnInfoCache[nodeId];
    if (cached && cached.length) {
      return cached;
    }
    return mapColumnsToInfo(node);
  };

  const isLoading = results.some((result) => result.isFetching);

  return { columnInfoCache, getColumnInfos, isLoading };
};

export default useNodeColumnInfos;
