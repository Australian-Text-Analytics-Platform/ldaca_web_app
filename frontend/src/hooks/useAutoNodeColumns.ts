import { useCallback, useEffect, useRef } from 'react';
import { type ColumnInfo, filterColumnsByType, mapColumnsToInfo, normalizeTypeName } from '../utils/columnTypes';
import columnPersistence from '../utils/columnPersistence';
import type { NodeLike } from './useNodeColumnInfos';
import { extractDocumentColumn } from '@/lib/documentColumn';
import { useNodeColumnPersistence } from './useNodeColumnPersistence';

export interface NodeColumnSelection {
  nodeId: string;
  column: string;
}

export interface UseAutoNodeColumnsOptions {
  selectedNodes: NodeLike[];
  maxNodes?: number;
  allowedDataTypes?: string[];
  docTypeOnly?: boolean;
  persist?: boolean;
  workspaceId?: string | null;
  storageScope?: string;
  isLocked?: boolean;
  getNodeColumns?: (node: NodeLike) => string[] | ColumnInfo[] | undefined;
  fallbackToAllColumns?: boolean;
}

interface ColumnOptionInfo {
  columns: ColumnInfo[];
  filteredOutByType: boolean;
}

type NodeColumnSource = string[] | ColumnInfo[];

/**
 * Resolves a stable selection key from the node shapes used by graph, tables, and tests.
 * Why: hook consumers need one stable boundary for state, effects, and cache coordination.
 */
const resolveNodeId = (node: NodeLike, idx: number): string => {
  return (
    node?.id ||
    node?.node_id ||
    node?.data?.id ||
    node?.data?.node_id ||
    node?.unique_id ||
    `node-${idx}`
  );
};

/** Canonicalizes typed column info before option lists compare/filter data types. */
const normalizeColumns = (columns: ColumnInfo[]): ColumnInfo[] => {
  return columns.map((col) => ({
    name: col.name,
    dataType: normalizeTypeName(col.dataType),
  }));
};

/**
 * Keeps text/analysis column choices synchronized with selected nodes,
 * optional dtype constraints, and per-workspace session persistence.
 *
 * Flow: hydrate persisted selections via useNodeColumnPersistence,
 * recompute defaults from selected nodes and dtype rules, derive
 * render-time column options, then expose choices, setters, options,
 * and recompute controls.
 */
export const useAutoNodeColumns = ({
  selectedNodes,
  maxNodes = 2,
  allowedDataTypes,
  docTypeOnly = false,
  persist = true,
  workspaceId,
  storageScope = 'analysis',
  isLocked = false,
  getNodeColumns,
  fallbackToAllColumns = true,
}: UseAutoNodeColumnsOptions) => {
  const {
    selections,
    setSelections,
    setSelection,
    setSelectionsState,
    lastSelectedIdsRef,
  } = useNodeColumnPersistence({ persist, workspaceId, storageScope });

  const selectedNodesRef = useRef(selectedNodes);
  const maxNodesRef = useRef(maxNodes);
  const allowedDataTypesRef = useRef(allowedDataTypes);
  const docTypeOnlyRef = useRef(docTypeOnly);
  const isLockedRef = useRef(isLocked);
  const getNodeColumnsRef = useRef(getNodeColumns);
  const fallbackToAllColumnsRef = useRef(fallbackToAllColumns);

  useEffect(() => {
    selectedNodesRef.current = selectedNodes;
    maxNodesRef.current = maxNodes;
    allowedDataTypesRef.current = allowedDataTypes;
    docTypeOnlyRef.current = docTypeOnly;
    isLockedRef.current = isLocked;
    getNodeColumnsRef.current = getNodeColumns;
    fallbackToAllColumnsRef.current = fallbackToAllColumns;
  }, [
    selectedNodes,
    maxNodes,
    allowedDataTypes,
    docTypeOnly,
    isLocked,
    getNodeColumns,
    fallbackToAllColumns,
  ]);

  /** Normalizes caller-provided column arrays, whether they are plain names or typed column info. */
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

  /** Recomputes auto-selected columns from selected nodes, using refs so locked task params do not drift mid-run. */
  const recomputeAutoColumns = useCallback(() => {
    if (isLockedRef.current) return;
    const nodes = selectedNodesRef.current;
    const ids = nodes.slice(0, maxNodesRef.current).map((n, idx) => resolveNodeId(n, idx)).filter(Boolean);
    lastSelectedIdsRef.current = ids;

    /** Derives columns during auto-selection using refs so locked task params do not drift mid-run. */
    const deriveColumnInfosLocal = (node: NodeLike): ColumnInfo[] => {
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
        if (filtered.length > 0) return filtered;
      }
      return infos;
    };

    setSelectionsState((prev) => {
      const prevMap = new Map(prev.map((s) => [s.nodeId, s.column]));
      const nextSelections = ids.map((nodeId, idx) => {
        const node = nodes[idx]!;
        const columnInfos = deriveColumnInfosLocal(node);
        const columns = columnInfos.map((col) => col.name);
        let column = prevMap.get(nodeId) || '';

        if (!column) {
          const documentColumn = extractDocumentColumn(node);
          if (documentColumn && columns.includes(documentColumn)) {
            column = documentColumn;
          } else if (!docTypeOnlyRef.current && columns.length > 0) {
            column = columns[0] || '';
          }
        }

        return { nodeId, column };
      });
      if (persist && workspaceId) {
        const persistMap: Record<string, string> = {};
        nextSelections.forEach(({ nodeId, column }) => {
          if (column) persistMap[nodeId] = column;
        });
        columnPersistence.storeAll(
          { workspaceId, scope: storageScope, storage: 'session' as const },
          persistMap,
        );
      }
      return nextSelections;
    });
  }, [persist, workspaceId, storageScope, setSelectionsState, lastSelectedIdsRef]);

  const selectedNodeIdsKey = selectedNodes.slice(0, maxNodes).map((n, idx) => resolveNodeId(n, idx)).filter(Boolean).join(',');

  useEffect(() => {
    const currIds = selectedNodeIdsKey.split(',').filter(Boolean);
    const last = lastSelectedIdsRef.current;
    if (currIds.length !== last.length || currIds.some((id, i) => id !== last[i])) {
      recomputeAutoColumns();
    }
  }, [selectedNodeIdsKey, recomputeAutoColumns, lastSelectedIdsRef]);

  const columnOptions = (() => {
      /** Derives render-time column options from current props so dropdowns reflect fresh metadata. */
      const deriveColumnInfosForRender = (node: NodeLike): ColumnInfo[] => {
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
          if (filtered.length > 0) return filtered;
        }
        return infos;
      };

      return selectedNodes.slice(0, maxNodes).reduce<Record<string, ColumnOptionInfo>>((acc, node, idx) => {
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
    })();

  return {
    selections,
    setSelection,
    setSelections,
    recomputeAutoColumns,
    columnOptions,
  };
};
