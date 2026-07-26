import { useQueries } from '@tanstack/react-query';
import {
  type ColumnInfo,
  mapArrowColumnsToInfo,
} from '@/features/workspace/data-view/utils/columnTypes';
import type { WorkspaceGraphNode, WorkspaceNodeInfo } from '@/api';
import type { WorkspaceNodeMetadata } from '../workspaceNodeMetadata';
import { nodeSchemaQueryOptions } from '@/lib/nodeSchema';

export interface UseNodeColumnInfosResult {
  columnInfoCache: Record<string, ColumnInfo[]>;
  /** Complete graph metadata keyed by Data Block id. */
  nodeInfoById: Record<string, WorkspaceNodeInfo>;
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
 * Pairs complete graph-node metadata with each node's authoritative Arrow
 * schema.
 * Used by: `useTabNodeInputs`, which already receives graph nodes from the
 * canonical Workspace graph query.
 */
export const useNodeColumnInfos = (params: {
  workspaceId?: string | null;
  nodes: WorkspaceGraphNode[];
  enabled?: boolean;
}): UseNodeColumnInfosResult => {
  const { workspaceId, nodes, enabled = true } = params;
  const nodeIds = nodes.map((node) => node.id);

  const queryEnabled = enabled && Boolean(workspaceId) && nodeIds.length > 0;
  const schemaQueries = useQueries({
    queries: nodeIds.map((nodeId) => ({
      ...nodeSchemaQueryOptions({ workspaceId: workspaceId ?? '', nodeId }),
      enabled: queryEnabled,
      staleTime: 60_000,
    })),
  });

  const nodeInfoById: Record<string, WorkspaceNodeInfo> = {};
  for (const node of nodes) {
    nodeInfoById[node.id] = node;
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

  /** Returns graph metadata for consumers that need the complete node shape. */
  /** Returned to: `useTabNodeInputs` for full metadata lookup. */
  const getNodeInfo = (
    node: WorkspaceNodeMetadata | null | undefined,
  ): WorkspaceNodeInfo | undefined => (node ? nodeInfoById[node.id] : undefined);

  const isLoading = schemaQueries.some((query) => query.isFetching);

  return { columnInfoCache, nodeInfoById, getColumnInfos, getNodeInfo, isLoading };
};
