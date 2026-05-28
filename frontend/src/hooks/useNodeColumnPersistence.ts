import { useCallback, useEffect, useRef, useState } from 'react';
import columnPersistence from '../utils/columnPersistence';

export interface NodeColumnSelection {
  nodeId: string;
  column: string;
}

export interface UseNodeColumnPersistenceOptions {
  persist?: boolean;
  workspaceId?: string | null;
  storageScope?: string;
}

/**
 * Manages node-column selection state with optional sessionStorage persistence.
 * Why: separation of persistence concerns from auto-selection logic so the hook
 * contracts stay narrow and testable.
 * Flow: on mount/scope change hydrate from storage; on setSelections/setSelection
 * mirror writes back to storage; on empty storage clear the key.
 */
export const useNodeColumnPersistence = ({
  persist = true,
  workspaceId,
  storageScope = 'analysis',
}: UseNodeColumnPersistenceOptions) => {
  const [selections, setSelectionsState] = useState<NodeColumnSelection[]>([]);
  const lastSelectedIdsRef = useRef<string[]>([]);

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
  const setSelections = useCallback(
    (next: NodeColumnSelection[], opts?: { replace?: boolean; persist?: boolean }) => {
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
    },
    [persist, workspaceId, storageScope],
  );

  /** Convenience setter used by single dropdown changes in feature parameter panels. */
  const setSelection = useCallback(
    (nodeId: string, column: string) => {
      setSelections([{ nodeId, column }], { replace: false });
    },
    [setSelections],
  );

  return { selections, setSelections, setSelection, setSelectionsState, lastSelectedIdsRef };
};
