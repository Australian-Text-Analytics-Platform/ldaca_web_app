import { useCallback, useEffect, useRef, useState } from 'react';
import { ColumnInfo, filterColumnsByType, mapColumnsToInfo, normalizeTypeName } from '../utils/columnTypes';
import columnPersistence from '../utils/columnPersistence';

export interface NodeColumnSelection {
  nodeId: string;
  column: string;
}

export interface UseAutoNodeColumnsOptions {
  selectedNodes: any[];
  maxNodes?: number;
  allowedDataTypes?: string[];
  docTypeOnly?: boolean;
  enableHeuristicGuess?: boolean;
  heuristicCandidates?: string[];
  persist?: boolean;
  workspaceId?: string | null;
  storageScope?: string;
  isLocked?: boolean;
  getNodeColumns?: (node: any) => string[] | ColumnInfo[] | undefined;
  fallbackToAllColumns?: boolean;
}

interface ColumnOptionInfo {
  columns: ColumnInfo[];
  filteredOutByType: boolean;
}

type NodeColumnSource = string[] | ColumnInfo[];

const DEFAULT_HEURISTIC_CANDIDATES = ['document', 'text', 'content', 'body', 'transcript'];

const extractDocumentColumn = (node: any): string => {
  const candidates = [
    (node?.data as { documentColumn?: string } | undefined)?.documentColumn,
    (node?.data as { document_column?: string } | undefined)?.document_column,
    (node?.data as { document?: string } | undefined)?.document,
    (node as { documentColumn?: string } | undefined)?.documentColumn,
    (node as { document_column?: string } | undefined)?.document_column,
    (node as { document?: string } | undefined)?.document,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length) {
      return candidate;
    }
  }

  return '';
};

const resolveNodeId = (node: any, idx: number): string => {
  return (
    node?.id ||
    node?.node_id ||
    node?.data?.id ||
    node?.data?.node_id ||
    node?.unique_id ||
    `node-${idx}`
  );
};

const normalizeColumns = (columns: ColumnInfo[]): ColumnInfo[] => {
  return columns.map((col) => ({
    name: col.name,
    dataType: normalizeTypeName(col.dataType),
  }));
};

export const useAutoNodeColumns = ({
  selectedNodes,
  maxNodes = 2,
  allowedDataTypes,
  docTypeOnly = false,
  enableHeuristicGuess = true,
  heuristicCandidates = DEFAULT_HEURISTIC_CANDIDATES,
  persist = true,
  workspaceId,
  storageScope = 'analysis',
  isLocked = false,
  getNodeColumns,
  fallbackToAllColumns = true,
}: UseAutoNodeColumnsOptions) => {
  const [selections, setSelectionsState] = useState<NodeColumnSelection[]>([]);
  const lastSelectedIdsRef = useRef<string[]>([]);
  const selectedNodesRef = useRef(selectedNodes);
  const maxNodesRef = useRef(maxNodes);
  const allowedDataTypesRef = useRef(allowedDataTypes);
  const docTypeOnlyRef = useRef(docTypeOnly);
  const enableHeuristicGuessRef = useRef(enableHeuristicGuess);
  const heuristicCandidatesRef = useRef(heuristicCandidates);
  const isLockedRef = useRef(isLocked);
  const getNodeColumnsRef = useRef(getNodeColumns);
  const fallbackToAllColumnsRef = useRef(fallbackToAllColumns);

  useEffect(() => {
    selectedNodesRef.current = selectedNodes;
    maxNodesRef.current = maxNodes;
    allowedDataTypesRef.current = allowedDataTypes;
    docTypeOnlyRef.current = docTypeOnly;
    enableHeuristicGuessRef.current = enableHeuristicGuess;
    heuristicCandidatesRef.current = heuristicCandidates;
    isLockedRef.current = isLocked;
    getNodeColumnsRef.current = getNodeColumns;
    fallbackToAllColumnsRef.current = fallbackToAllColumns;
  }, [
    selectedNodes,
    maxNodes,
    allowedDataTypes,
    docTypeOnly,
    enableHeuristicGuess,
    heuristicCandidates,
    isLocked,
    getNodeColumns,
    fallbackToAllColumns,
  ]);

  const resolvePersistenceContext = () => {
    if (!persist || !workspaceId) {
      return null;
    }
    return {
      workspaceId,
      scope: storageScope,
      storage: 'session' as const,
    };
  };

  useEffect(() => {
    const persistenceCtx = resolvePersistenceContext();
    if (!persistenceCtx) {
      if (!workspaceId) {
        setSelectionsState([]);
      }
      return;
    }
    const persisted = columnPersistence.readAll(persistenceCtx);
    if (persisted) {
      const hydrated = Object.entries(persisted).map(([nodeId, column]) => ({ nodeId, column }));
      setSelectionsState(hydrated);
      lastSelectedIdsRef.current = hydrated.map(({ nodeId }) => nodeId);
    }
  }, [persist, storageScope, workspaceId]);

  const persistSelections = (next: NodeColumnSelection[]) => {
    const persistenceCtx = resolvePersistenceContext();
    if (!persistenceCtx) return;
    const map: Record<string, string> = {};
    next.forEach(({ nodeId, column }) => {
      if (column) {
        map[nodeId] = column;
      }
    });
    columnPersistence.storeAll(persistenceCtx, map);
  };

  const setSelections = (next: NodeColumnSelection[], opts?: { replace?: boolean; persist?: boolean }) => {
    setSelectionsState((prev) => {
      let updated: NodeColumnSelection[];
      if (opts?.replace) {
        updated = next;
      } else {
        const map = new Map<string, NodeColumnSelection>();
        prev.forEach((sel) => map.set(sel.nodeId, sel));
        next.forEach((sel) => map.set(sel.nodeId, sel));
        updated = Array.from(map.values());
      }
      if (opts?.persist !== false) persistSelections(updated);
      return updated;
    });
  };

  const setSelection = (nodeId: string, column: string) => {
    setSelections([{ nodeId, column }], { replace: false });
  };

  const normalizeColumnInfos = (source: NodeColumnSource | undefined): ColumnInfo[] => {
    if (!source || !Array.isArray(source) || source.length === 0) return [];
    const first = source[0];
    if (typeof first === 'string') {
      return (source as string[]).map((name) => ({ name, dataType: 'string' }));
    }
    return (source as ColumnInfo[]).map((col) => ({
      name: col.name,
      dataType: normalizeTypeName(col.dataType),
    }));
  };

  const deriveColumnInfos = (node: any): ColumnInfo[] => {
    let infos: ColumnInfo[] = [];
    if (getNodeColumnsRef.current) {
      infos = normalizeColumnInfos(getNodeColumnsRef.current(node));
    }
    if (!infos.length) {
      infos = mapColumnsToInfo(node);
    }
    if (!infos.length && fallbackToAllColumnsRef.current && Array.isArray(node?.columns)) {
      infos = normalizeColumnInfos(node.columns as NodeColumnSource);
    }

    if (allowedDataTypesRef.current?.length) {
      const filtered = filterColumnsByType(infos, allowedDataTypesRef.current);
      if (filtered.length > 0) {
        return filtered;
      }
    }

    return infos;
  };

  const deriveColumnInfosForRender = (node: any): ColumnInfo[] => {
    let infos: ColumnInfo[] = [];
    if (getNodeColumns) {
      infos = normalizeColumnInfos(getNodeColumns(node));
    }
    if (!infos.length) {
      infos = mapColumnsToInfo(node);
    }
    if (!infos.length && fallbackToAllColumns && Array.isArray(node?.columns)) {
      infos = normalizeColumnInfos(node.columns as NodeColumnSource);
    }

    if (allowedDataTypes?.length) {
      const filtered = filterColumnsByType(infos, allowedDataTypes);
      if (filtered.length > 0) {
        return filtered;
      }
    }

    return infos;
  };

  const recomputeAutoColumns = useCallback(() => {
    if (isLockedRef.current) return;
    const nodes = selectedNodesRef.current;
    const ids = nodes.slice(0, maxNodesRef.current).map((n, idx) => resolveNodeId(n, idx)).filter(Boolean);
    lastSelectedIdsRef.current = ids;
    setSelectionsState((prev) => {
      const prevMap = new Map(prev.map((s) => [s.nodeId, s.column]));
      const nextSelections = ids.map((nodeId, idx) => {
        const node = nodes[idx];
        const columnInfos = deriveColumnInfos(node);
        const columns = columnInfos.map((col) => col.name);
        let column = prevMap.get(nodeId) || '';

        if (!column) {
          const documentColumn = extractDocumentColumn(node);
          if (documentColumn && columns.includes(documentColumn)) {
            column = documentColumn;
          } else if (enableHeuristicGuessRef.current && (!docTypeOnlyRef.current || documentColumn)) {
            const candidate = columns.find((name) =>
              (heuristicCandidatesRef.current ?? []).some((needle) =>
                name.toLowerCase().includes(needle.toLowerCase())
              )
            );
            column = candidate || '';
          } else if (!docTypeOnlyRef.current && columns.length > 0) {
            column = columns[0] || '';
          }
        }

        return { nodeId, column };
      });
      persistSelections(nextSelections);
      return nextSelections;
    });
  }, [persistSelections]);

  useEffect(() => {
    const currIds = selectedNodes.slice(0, maxNodes).map((n, idx) => resolveNodeId(n, idx)).filter(Boolean);
    const last = lastSelectedIdsRef.current;
    if (currIds.length !== last.length || currIds.some((id, i) => id !== last[i])) {
      recomputeAutoColumns();
    }
  }, [selectedNodes, maxNodes, recomputeAutoColumns]);

  const columnOptions = selectedNodes.slice(0, maxNodes).reduce<Record<string, ColumnOptionInfo>>((acc, node, idx) => {
    const nodeId = resolveNodeId(node, idx);
    const infos = normalizeColumns(deriveColumnInfosForRender(node));
    const filtered = allowedDataTypes?.length ? filterColumnsByType(infos, allowedDataTypes) : infos;
    const filteredOutByType = Boolean(allowedDataTypes?.length && infos.length && filtered.length === 0);
    acc[nodeId] = {
      columns: filtered.length ? filtered : infos,
      filteredOutByType,
    };
    return acc;
  }, {});

  return {
    selections,
    setSelection,
    setSelections,
    recomputeAutoColumns,
    columnOptions,
  };
};