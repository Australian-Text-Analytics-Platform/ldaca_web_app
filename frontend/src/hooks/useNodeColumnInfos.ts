import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { nodesApi } from '../api/nodes';
import { useAuth } from './useAuth';
import { ColumnInfo, mapColumnsToInfo } from '../utils/columnTypes';

const resolveNodeId = (node: any, fallbackIndex: number): string | null => {
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
  getColumnInfos: (node: any, idx?: number) => ColumnInfo[];
  /** True while one or more schemas are being fetched. */
  isLoading: boolean;
}

export const useNodeColumnInfos = (
  params: {
    workspaceId?: string | null;
    nodes: any[];
    enabled?: boolean;
  },
): UseNodeColumnInfosResult => {
  const { workspaceId, nodes, enabled = true } = params;
  const { getAuthHeaders } = useAuth();
  const [cache, setCache] = useState<Record<string, ColumnInfo[]>>({});
  const pendingRef = useRef<Set<string>>(new Set());
  const [, forceTick] = useState(0); // triggers rerender when pending set changes

  const nodeIds = useMemo(() => (
    nodes.map((node, idx) => resolveNodeId(node, idx)).filter((id): id is string => !!id)
  ), [nodes]);

  useEffect(() => {
    if (!enabled || !workspaceId) return;
    const headers = getAuthHeaders();
    const idsToFetch = nodeIds.filter((id) => id && !cache[id] && !pendingRef.current.has(id));
    if (!idsToFetch.length) return;

    let cancelled = false;
    idsToFetch.forEach((id) => pendingRef.current.add(id));
    forceTick((tick) => tick + 1);

    (async () => {
      try {
        await Promise.all(idsToFetch.map(async (nodeId) => {
          try {
            const info = await nodesApi.info(workspaceId, nodeId, headers);
            if (cancelled) return;
            const infos = mapColumnsToInfo(info);
            setCache((prev) => {
              if (prev[nodeId] && prev[nodeId].length === infos.length) {
                // no change, keep previous reference to avoid extra renders
                return prev;
              }
              return { ...prev, [nodeId]: infos };
            });
          } catch (error) {
            if (!cancelled) {
              setCache((prev) => ({ ...prev, [nodeId]: prev[nodeId] || [] }));
            }
          } finally {
            pendingRef.current.delete(nodeId);
            if (!cancelled) forceTick((tick) => tick + 1);
          }
        }));
      } catch (error) {
        idsToFetch.forEach((id) => pendingRef.current.delete(id));
        forceTick((tick) => tick + 1);
      }
    })();

    return () => {
      cancelled = true;
      idsToFetch.forEach((id) => pendingRef.current.delete(id));
      forceTick((tick) => tick + 1);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, workspaceId, getAuthHeaders, nodeIds.join('|'), cache]);

  const getColumnInfos = useCallback((node: any, idx = 0): ColumnInfo[] => {
    const nodeId = resolveNodeId(node, idx);
    if (!nodeId) return [];
    const cached = cache[nodeId];
    if (cached && cached.length) {
      return cached;
    }
    return mapColumnsToInfo(node);
  }, [cache]);

  const isLoading = pendingRef.current.size > 0;

  return { columnInfoCache: cache, getColumnInfos, isLoading };
};

export default useNodeColumnInfos;
