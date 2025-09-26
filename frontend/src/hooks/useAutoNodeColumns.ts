import { useCallback, useEffect, useRef, useState } from 'react';
import { ColumnInfo, filterColumnsByType, mapColumnsToInfo, normalizeTypeName } from '../utils/columnTypes';

/** Represents a chosen text column for a node */
export interface NodeColumnSelection {
  nodeId: string;
  column: string; // empty string means 'not chosen yet'
}

export interface UseAutoNodeColumnsOptions {
  /** Workspace id to namespace persistence. If absent, persistence is disabled. */
  workspaceId?: string | null;
  /** Max nodes considered (e.g. 2 for pairwise comparisons) */
  maxNodes?: number;
  /** Whether the panel is locked (do not mutate selections automatically) */
  isLocked?: boolean;
  /** Additional storage key suffix (tab identifier) so different tabs can share or separate.  If omitted both TokenFrequency + Concordance intentionally share. */
  storageScope?: string; // if undefined both tabs share; pass distinct value to isolate
  /** If true we only auto-pick a default column when nodeType contains 'Doc' (current behaviour in existing tabs). */
  docTypeOnly?: boolean;
  /** Enable heuristic guessing for non DocType nodes (currently off to preserve prior behaviour). */
  enableHeuristicGuess?: boolean;
  /** Heuristic candidate column names (case-insensitive) used when guessing. */
  heuristicCandidates?: string[];
  /** If true selections are persisted in sessionStorage (default true). */
  persist?: boolean;
}

interface AutoNodeColumnsHookReturn {
  selections: NodeColumnSelection[];
  /** Update a single node selection */
  setSelection: (nodeId: string, column: string) => void;
  /** Replace or merge multiple selections (used by hydration). */
  setSelections: (next: NodeColumnSelection[], opts?: { replace?: boolean; persist?: boolean }) => void;
  /** Force a recomputation of auto selections for currently selected nodes (ignores locked). */
  recompute: () => void;
}

/**
 * Shared hook that:
 * 1. Maintains node -> text column selections.
 * 2. Auto-selects a default column for Doc* nodes (documentColumn) or heuristic fallback if enabled.
 * 3. Persists selections per workspace (sessionStorage) so switching tabs retains user choices.
 * 4. Never overwrites an explicit user choice or a hydrated backend request unless replace=true.
 * 5. Designed to be tab-agnostic; by default Concordance & Token Frequency share the same persisted mapping.
 *
 * Persistence Strategy:
 *  - sessionStorage over localStorage so a fresh browser session starts clean while intra-session tab switches retain state.
 *  - Key pattern: autoNodeCols:<workspaceId>[:<scope>]
 *
 * Future Enhancements:
 *  - Optional per-node last-used multi-column memory.
 *  - Support for explicit reset/clear action.
 *
 * Testing Notes:
 *  - Frontend test harness not yet established for hooks; a TODO marker is placed below for future jest/react-testing-library coverage.
 */
type NodeColumnSource = string[] | ColumnInfo[];

export function useAutoNodeColumns(
  params: {
    selectedNodes: any[];
    getNodeColumns?: (node: any) => NodeColumnSource;
    allowedDataTypes?: string[];
    fallbackToAllColumns?: boolean;
  },
  options: UseAutoNodeColumnsOptions = {}
): AutoNodeColumnsHookReturn {
  const {
    selectedNodes,
    getNodeColumns,
    allowedDataTypes = [],
    fallbackToAllColumns = false,
  } = params;
  const {
    workspaceId,
    maxNodes = 2,
    isLocked = false,
    storageScope, // intentionally undefined so TokenFrequency + Concordance share by default
    docTypeOnly = true,
    enableHeuristicGuess = false,
    heuristicCandidates = ['text','body','content','document','transcript','message','utterance'],
    persist = true,
  } = options;

  const storageKey = workspaceId && persist
    ? `autoNodeCols:${workspaceId}${storageScope ? ':' + storageScope : ''}`
    : null;

  const [selections, setSelectionsState] = useState<NodeColumnSelection[]>([]);
  const initializedRef = useRef(false);
  const lastSelectedIdsRef = useRef<string[]>([]);

  // Load persisted selections once
  useEffect(() => {
    if (!storageKey || initializedRef.current) return;
    initializedRef.current = true;
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string,string>;
        const arr: NodeColumnSelection[] = Object.entries(parsed).map(([nodeId, column]) => ({ nodeId, column }));
        setSelectionsState(arr);
      }
    } catch (_) { /* ignore */ }
  }, [storageKey]);

  const persistSelections = useCallback((next: NodeColumnSelection[]) => {
    if (!storageKey) return;
    try {
      const map: Record<string,string> = {};
      next.forEach(s => { if (s.column) map[s.nodeId] = s.column; });
      sessionStorage.setItem(storageKey, JSON.stringify(map));
    } catch (_) { /* ignore */ }
  }, [storageKey]);

  const setSelections = useCallback((next: NodeColumnSelection[], opts?: { replace?: boolean; persist?: boolean }) => {
    setSelectionsState(prev => {
      let updated: NodeColumnSelection[];
      if (opts?.replace) {
        updated = [...next];
      } else {
        // merge by nodeId
        const map = new Map<string,string>();
        prev.forEach(p => map.set(p.nodeId, p.column));
        next.forEach(n => { map.set(n.nodeId, n.column); });
        updated = Array.from(map.entries()).map(([nodeId, column]) => ({ nodeId, column }));
      }
      if (opts?.persist !== false) persistSelections(updated);
      return updated;
    });
  }, [persistSelections]);

  const setSelection = useCallback((nodeId: string, column: string) => {
    setSelections([{ nodeId, column }], { replace: false });
  }, [setSelections]);

  // Auto-update selections when selectedNodes changes (unless locked)
  const normalizeColumnInfos = useCallback((source: NodeColumnSource | undefined): ColumnInfo[] => {
    if (!source) return [];
    if (!Array.isArray(source) || source.length === 0) return [];
    const first = source[0];
    if (typeof first === 'string') {
      return (source as string[]).map((name) => ({ name, dataType: 'string' }));
    }
    return (source as ColumnInfo[]).map((col) => ({ name: col.name, dataType: normalizeTypeName(col.dataType) }));
  }, []);

  const deriveColumnInfos = useCallback((node: any): ColumnInfo[] => {
    let infos: ColumnInfo[] = [];
    if (getNodeColumns) {
      infos = normalizeColumnInfos(getNodeColumns(node));
    } else {
      infos = mapColumnsToInfo(node);
    }
    if (allowedDataTypes.length) {
      const filtered = filterColumnsByType(infos, allowedDataTypes);
      if (filtered.length > 0) {
        return filtered;
      }
      if (!fallbackToAllColumns) {
        return filtered;
      }
    }
    return infos;
  }, [allowedDataTypes, fallbackToAllColumns, getNodeColumns, normalizeColumnInfos]);

  const recompute = useCallback(() => {
    if (isLocked) return;
    const ids = selectedNodes.slice(0, maxNodes).map(n => n.id).filter(Boolean);
    lastSelectedIdsRef.current = ids;
    setSelectionsState(prev => {
      // Build map for quick lookup
      const prevMap = new Map(prev.map(p => [p.nodeId, p.column]));
      const next: NodeColumnSelection[] = [];
      ids.forEach(id => {
        const node = selectedNodes.find(n => n.id === id);
        const existing = prevMap.get(id);
        if (existing) {
          next.push({ nodeId: id, column: existing });
          return;
        }
        // Auto select logic
        let column = '';
        if (node) {
          const cols = deriveColumnInfos(node).map((info) => info.name);
            const documentColumn = node.data?.documentColumn || node.data?.document_column;
            const isDocType = !!(node.data?.nodeType && node.data.nodeType.includes('Doc'));
            if (documentColumn && cols.includes(documentColumn)) {
              column = documentColumn;
            } else if ((!docTypeOnly || (isDocType && !documentColumn)) && enableHeuristicGuess) {
              // attempt heuristic guess
              const lowerCols = cols.map(c => c.toLowerCase());
              const found = heuristicCandidates.find(cand => lowerCols.includes(cand.toLowerCase()));
              if (found) {
                const idx = lowerCols.indexOf(found.toLowerCase());
                column = cols[idx];
              }
            }
        }
        next.push({ nodeId: id, column });
      });
      // retain previous persisted selections for nodes no longer selected without altering them (not included in next state intentionally)
      persistSelections(next);
      return next;
    });
  }, [deriveColumnInfos, enableHeuristicGuess, docTypeOnly, heuristicCandidates, isLocked, maxNodes, persistSelections, selectedNodes]);

  useEffect(() => {
    const currIds = selectedNodes.slice(0, maxNodes).map(n => n.id).filter(Boolean);
    const last = lastSelectedIdsRef.current;
    if (currIds.length !== last.length || currIds.some((id, i) => id !== last[i])) {
      recompute();
    }
  }, [selectedNodes, maxNodes, recompute]);

  return { selections, setSelection, setSelections, recompute };
}

export default useAutoNodeColumns;

// TODO: Add unit test verifying heuristicCandidates ordering + docTypeOnly behaviour once frontend test harness is in place.
