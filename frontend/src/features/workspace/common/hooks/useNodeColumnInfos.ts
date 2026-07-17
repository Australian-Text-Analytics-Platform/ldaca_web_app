import { useQueries, useQuery } from '@tanstack/react-query';
import {
  type ColumnInfo,
  mapArrowColumnsToInfo,
} from '@/features/workspace/data-view/utils/columnTypes';
import type { WorkspaceGraphNode, WorkspaceNodeInfo } from '@/api';
import type { WorkspaceNodeMetadata } from '../workspaceNodeMetadata';
import { nodeInfosQueryOptions } from '@/lib/nodeInfo';
import { nodeSchemaQueryOptions } from '@/lib/nodeSchema';

export interface UseNodeColumnInfosResult {
  columnInfoCache: Record<string, ColumnInfo[]>;
  /** Full node-info responses keyed by node id for metadata beyond columns. */
  nodeInfoCache: Record<string, WorkspaceNodeInfo>;
  /**
   * Returns cached column infos for the provided node.
   */
  getColumnInfos: (node: WorkspaceNodeMetadata | null | undefined) => ColumnInfo[];
  /** Returns the cached node-info response for consumers that need shape or tokenizer metadata. */
  getNodeInfo: (node: WorkspaceNodeMetadata | null | undefined) => WorkspaceNodeInfo | undefined;
  /** True while one or more schemas are being fetched. */
  isLoading: boolean;
}

/**
 * Fetch typed column info from each node's authoritative Arrow schema.
 */
/**
 * Used by: `useTabNodeInputs` to hydrate selected graph nodes with typed
 * column and full node metadata.
 * Flow: resolve live node ids, issue one batch node-info query, build typed metadata caches, then return cached getters and loading flag.
 */
export const useNodeColumnInfos = (params: {
  workspaceId?: string | null;
  nodes: WorkspaceGraphNode[];
  enabled?: boolean;
}): UseNodeColumnInfosResult => {
  const { workspaceId, nodes, enabled = true } = params;
  const nodeIds = nodes.map((node) => node.id);

  const queryEnabled = enabled && Boolean(workspaceId) && nodeIds.length > 0;
  const nodeInfosQuery = useQuery({
    ...nodeInfosQueryOptions({ workspaceId: workspaceId ?? '', nodeIds }),
    enabled: queryEnabled,
    staleTime: 60_000,
  });
  const schemaQueries = useQueries({
    queries: nodeIds.map((nodeId) => ({
      ...nodeSchemaQueryOptions({ workspaceId: workspaceId ?? '', nodeId }),
      enabled: queryEnabled,
      staleTime: 60_000,
    })),
  });

  const nodeInfoCache: Record<string, WorkspaceNodeInfo> = {};
  for (const nodeInfo of nodeInfosQuery.data ?? []) {
    nodeInfoCache[nodeInfo.id] = nodeInfo;
  }

  const columnInfoCache: Record<string, ColumnInfo[]> = {};
  nodeIds.forEach((nodeId, index) => {
    const schema = schemaQueries[index]?.data;
    if (schema) columnInfoCache[nodeId] = mapArrowColumnsToInfo(schema);
  });

  /** Returns typed cached columns when available. */
  /** Returned to: `useTabNodeInputs` for selector and request hydration. */
  const getColumnInfos = (node: WorkspaceNodeMetadata | null | undefined): ColumnInfo[] => {
    if (!node) return [];
    return columnInfoCache[node.id] ?? [];
  };

  /** Returns cached node metadata for consumers that need full node-info fields. */
  /** Returned to: `useTabNodeInputs` for full metadata projection. */
  const getNodeInfo = (
    node: WorkspaceNodeMetadata | null | undefined,
  ): WorkspaceNodeInfo | undefined => (node ? nodeInfoCache[node.id] : undefined);

  const isLoading = nodeInfosQuery.isFetching || schemaQueries.some((query) => query.isFetching);

  return { columnInfoCache, nodeInfoCache, getColumnInfos, getNodeInfo, isLoading };
};
