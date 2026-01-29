import { useEffect, useRef, useState } from 'react';
import { useAuth } from './useAuth';
import { ColumnInfo, mapColumnsToInfo } from '../utils/columnTypes';
import { getNodeInfo } from '../lib/nodeInfoCache';

type NodeLike = Record<string, unknown> & {
  id?: string;
  node_id?: string;
  data?: Record<string, unknown> & {
    id?: string;
    node_id?: string;
  };
  unique_id?: string;
};

const resolveNodeId = (node: NodeLike | null | undefined, fallbackIndex: number): string | null => {
  if (!node) return null;
  const candidates = [
    node.id,
    node.node_id,
    node.data?.id,
    node.data?.node_id,
    node.unique_id,
  ];
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
   * Returns cached column infos for the provided node. Falls back to basic mapping if the cache
   * has not been hydrated yet, ensuring the selector always renders something while the typed
   * schema is loading.
   */
  getColumnInfos: (node: NodeLike | null | undefined, idx?: number) => ColumnInfo[];
  /** True while one or more schemas are being fetched. */
  isLoading: boolean;
}

export const useNodeColumnInfos = (
  params: {
    workspaceId?: string | null;
  nodes: NodeLike[];
    enabled?: boolean;
  },
): UseNodeColumnInfosResult => {
  const { workspaceId, nodes, enabled = true } = params;
  const { getAuthHeaders } = useAuth();
  const [cache, setCache] = useState<Record<string, ColumnInfo[]>>({});
  const pendingRef = useRef<Set<string>>(new Set());
  const [, forceTick] = useState(0); // triggers rerender when pending set changes

  const nodeIds = nodes.map((node, idx) => resolveNodeId(node, idx)).filter((id): id is string => !!id);
  const nodeIdsKey = nodeIds.join('|');

  useEffect(() => {
    if (!enabled || !workspaceId) return;
    const pendingSet = pendingRef.current;
    const idsToFetch = nodeIds.filter((id) => id && !cache[id] && !pendingSet.has(id));
    if (!idsToFetch.length) return;

    let cancelled = false;
    idsToFetch.forEach((id) => pendingSet.add(id));
    forceTick((tick) => tick + 1);

    (async () => {
      try {
        await Promise.all(idsToFetch.map(async (nodeId) => {
          try {
            const info = await getNodeInfo({
              workspaceId,
              nodeId,
              getAuthHeaders,
              force: true,
            });
            if (cancelled) return;
            const infos = mapColumnsToInfo(info);
            setCache((prev) => {
              if (prev[nodeId] && prev[nodeId].length === infos.length) {
                // no change, keep previous reference to avoid extra renders
                return prev;
              }
              return { ...prev, [nodeId]: infos };
            });
          } catch {
            if (!cancelled) {
              setCache((prev) => ({ ...prev, [nodeId]: prev[nodeId] || [] }));
            }
          } finally {
            pendingSet.delete(nodeId);
            if (!cancelled) forceTick((tick) => tick + 1);
          }
        }));
      } catch {
        idsToFetch.forEach((id) => pendingSet.delete(id));
        forceTick((tick) => tick + 1);
      }
    })();

    return () => {
      cancelled = true;
      idsToFetch.forEach((id) => pendingSet.delete(id));
      forceTick((tick) => tick + 1);
    };
  }, [enabled, workspaceId, getAuthHeaders, nodeIdsKey, cache]);

  const getColumnInfos = (node: NodeLike | null | undefined, idx = 0): ColumnInfo[] => {
    const nodeId = resolveNodeId(node, idx);
    if (!nodeId) return [];
    const cached = cache[nodeId];
    if (cached && cached.length) {
      return cached;
    }
    return mapColumnsToInfo(node);
  };

  const isLoading = pendingRef.current.size > 0;

  return { columnInfoCache: cache, getColumnInfos, isLoading };
};

export default useNodeColumnInfos;
