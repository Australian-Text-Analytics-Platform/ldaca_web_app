import { useCallback, useEffect, useRef, useState } from 'react';
import { type ColumnInfo, filterColumnsByType, mapColumnsToInfo, normalizeTypeName } from '../utils/columnTypes';
import columnPersistence from '../utils/columnPersistence';
import type { NodeLike } from './useNodeColumnInfos';

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

/** Finds the backend-declared document column so text-analysis tools prefer the intended text field. */
/**
 * Called by: useAutoNodeColumns because node payloads expose the document column through legacy and backend-normalized aliases.
 * Flow: inspect data-level and top-level document aliases, return the first non-empty string, otherwise leave auto-selection empty.
 */
const extractDocumentColumn = (node: NodeLike): string => {
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
/** Called by: useAutoNodeColumns in this hook module because the hook needs local steps to normalize inputs before exposing stable state to consumers. */
const normalizeColumns = (columns: ColumnInfo[]): ColumnInfo[] => {
  return columns.map((col) => ({
    name: col.name,
    dataType: normalizeTypeName(col.dataType),
  }));
};

/**
 * Keeps text/analysis column choices synchronized with selected nodes,
 * optional dtype constraints, and per-workspace session persistence.
 */
/**
 * Used by: src/features/analysis/common/useAnalysisLockMachine.ts, src/hooks/__tests__/useAutoNodeColumns.test.tsx because the tests need reusable fixtures or mocks before exercising the behavior under assertion.
 * Flow: hydrate persisted selections, recompute defaults from selected nodes and dtype rules, then expose choices, setters, options, and recompute controls.
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
  const [selections, setSelectionsState] = useState<NodeColumnSelection[]>([]);
  const lastSelectedIdsRef = useRef<string[]>([]);
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

  /* eslint-disable react-hooks/set-state-in-effect -- Hydrating persisted column selections on workspace/scope change; no cascading renders */
  useEffect(() => {
    const persistenceCtx =
      persist && workspaceId ? { workspaceId, scope: storageScope, storage: 'session' as const } : null;
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
  }, [persist, workspaceId, storageScope]);
  /* eslint-enable react-hooks/set-state-in-effect */

  /** Updates one or more node-column selections and mirrors them to scoped persistence. */
  /**
    * Called by: dropdown setters and auto-recompute because manual and inferred column choices must share one persistence path.
    * Flow: merge or replace selections, skip structurally equal state, then persist non-empty choices by workspace and scope.
   */
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
        // Return prev reference when structurally equal to avoid unnecessary re-renders
        if (
          updated.length === prev.length &&
          updated.every((sel, i) => sel.nodeId === prev[i]!.nodeId && sel.column === prev[i]!.column)
        ) {
          return prev;
        }
        if (opts?.persist !== false && persist && workspaceId) {
          const persistMap: Record<string, string> = {};
          updated.forEach(({ nodeId, column }) => {
            if (column) persistMap[nodeId] = column;
          });
          columnPersistence.storeAll(
            { workspaceId, scope: storageScope, storage: 'session' as const },
            persistMap,
          );
        }
        return updated;
      });
    };

  /**
   * Convenience setter used by single dropdown changes in feature parameter panels.
   * Why: hook consumers need one stable boundary for state, effects, and cache coordination.
   */
  const setSelection = (nodeId: string, column: string) => {
      setSelections([{ nodeId, column }], { replace: false });
    };

  /** Normalizes caller-provided column arrays, whether they are plain names or typed column info. */
  /**
    * Called by: local and render column derivation because selected nodes can carry either names or typed column metadata.
    * Flow: return no options for missing sources, wrap string names as string columns, then normalize provided data type names.
   */
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

  // Identity stability: used in useEffect dependency array
  const recomputeAutoColumns = useCallback(() => {
    if (isLockedRef.current) return;
    const nodes = selectedNodesRef.current;
    const ids = nodes.slice(0, maxNodesRef.current).map((n, idx) => resolveNodeId(n, idx)).filter(Boolean);
    lastSelectedIdsRef.current = ids;

    /** Derives columns during auto-selection using refs so locked task params do not drift mid-run. */
    /**
      * Called by: recomputeAutoColumns because auto-selection reads refs while task locking freezes the submitted parameters.
      * Flow: prefer caller-supplied columns, fall back to node metadata and raw columns, then apply allowed data-type filters when they match.
     */
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
  }, [persist, workspaceId, storageScope]);

  const selectedNodeIdsKey = selectedNodes.slice(0, maxNodes).map((n, idx) => resolveNodeId(n, idx)).filter(Boolean).join(',');

  useEffect(() => {
    const currIds = selectedNodeIdsKey.split(',').filter(Boolean);
    const last = lastSelectedIdsRef.current;
    if (currIds.length !== last.length || currIds.some((id, i) => id !== last[i])) {
      recomputeAutoColumns();
    }
  }, [selectedNodeIdsKey, recomputeAutoColumns]);

  const columnOptions = (() => {
      /** Derives render-time column options from current props so dropdowns reflect fresh metadata. */
      /**
        * Called by: columnOptions computation because dropdowns should reflect the latest props instead of the refs used for locked recompute.
        * Flow: derive typed options from current props, fall back through node metadata, then preserve unfiltered options when dtype filtering would hide everything.
       */
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