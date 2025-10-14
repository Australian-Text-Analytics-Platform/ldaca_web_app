import { useState, useMemo, useCallback } from 'react';
import type { WorkspaceNodeLike } from '../components/NodeSelectionPanel';
import { useAutoNodeColumns } from './useAutoNodeColumns';
import { useWorkspaceSelection } from './useWorkspaceSelection';
import { useWorkspaceData } from './useWorkspaceData';
import { useNodeColumnInfos } from './useNodeColumnInfos';

export interface AnalysisLockConfig {
  /**
   * Allowed data types for column selection (e.g., ['string'], ['datetime'])
   */
  allowedDataTypes: string[];
  
  /**
   * Maximum number of nodes to allow in selection
   */
  maxNodes?: number;
  
  /**
   * Whether to only select doc_type columns
   */
  docTypeOnly?: boolean;
  
  /**
   * Whether to enable heuristic column guessing
   */
  enableHeuristicGuess?: boolean;
  
  /**
   * Storage scope for auto column selection (undefined = shared across tabs)
   */
  storageScope?: string;
}

export interface LockedNodesSnapshot {
  id: string;
  name: string;
  columns: string[];
}

/**
 * Shared hook for managing analysis tab locking state and node picker configuration.
 * 
 * This hook encapsulates the common pattern across analysis tabs:
 * - Lock/unlock mechanism to freeze node selection
 * - Auto column selection with configurable filters
 * - Snapshot of locked nodes with their columns
 * - Active node resolution (locked vs current selection)
 * 
 * @param config - Configuration for column selection behavior
 * @returns Lock state management and node picker utilities
 */
export function useAnalysisLockState(config: AnalysisLockConfig) {
  const {
    allowedDataTypes,
    maxNodes = 2,
    docTypeOnly = false,
    enableHeuristicGuess = false,
    storageScope,
  } = config;

  const { selectedNodes } = useWorkspaceSelection();
  const { currentWorkspaceId } = useWorkspaceData();

  const { getColumnInfos } = useNodeColumnInfos({
    workspaceId: currentWorkspaceId,
    nodes: selectedNodes,
  });

  // Lock state
  const [isLocked, setIsLocked] = useState(false);
  const [lockedNodesSnapshot, setLockedNodesSnapshot] = useState<LockedNodesSnapshot[]>([]);

  // Auto column selection hook
  const {
    selections: nodeColumnSelections,
    setSelection: setNodeColumnSelection,
    setSelections: setNodeColumnSelections,
    recompute: recomputeAutoColumns,
  } = useAutoNodeColumns(
    {
      selectedNodes,
      getNodeColumns: getColumnInfos,
      allowedDataTypes,
    },
    {
      workspaceId: currentWorkspaceId,
      maxNodes,
      isLocked,
      docTypeOnly,
      enableHeuristicGuess,
      storageScope,
    }
  );

  // Node ID to name mapping
  const nodeIdToName = useMemo(() => {
    const map: Record<string, string> = {};
    selectedNodes.forEach((n) => {
      const name =
        n.name ||
        n.data?.name ||
        n.data?.label ||
        n.data?.nodeName ||
        n.id;
      map[n.id] = String(name);
    });
    return map;
  }, [selectedNodes]);

  // Locked node name mapping
  const lockedNodeNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    lockedNodesSnapshot.forEach(({ id, name }) => {
      map[id] = name;
    });
    return map;
  }, [lockedNodesSnapshot]);

  /**
   * Unlock and clear snapshot
   */
  const unlockSelection = useCallback(() => {
    setIsLocked(false);
    setLockedNodesSnapshot([]);
  }, []);

  /**
   * Apply an explicit snapshot payload and lock selection
   */
  const lockWithSnapshots = useCallback(
    (
      snapshotInput:
        | Array<{ id: string; name?: string; columns?: string[] | null }>
        | { id: string; name?: string; columns?: string[] | null }
        | null
        | undefined
    ) => {
      if (!snapshotInput) {
        unlockSelection();
        return;
      }

      const snapshotArray = Array.isArray(snapshotInput) ? snapshotInput : [snapshotInput];
      const normalized: LockedNodesSnapshot[] = snapshotArray
        .filter((snap): snap is { id: string; name?: string; columns?: string[] | null } => Boolean(snap?.id))
        .map((snap) => ({
          id: snap.id,
          name: snap.name ?? snap.id,
          columns: Array.isArray(snap.columns)
            ? snap.columns.filter((col): col is string => typeof col === 'string')
            : [],
        }));

      if (!normalized.length) {
        unlockSelection();
        return;
      }

      setLockedNodesSnapshot(normalized);
      setIsLocked(true);
    },
    [unlockSelection, setLockedNodesSnapshot, setIsLocked]
  );

  /**
   * Lock current selection and create snapshot
   */
  const lockSelection = useCallback(() => {
    const snapshot = nodeColumnSelections.map((sel) => ({
      id: sel.nodeId,
      name: nodeIdToName[sel.nodeId] || sel.nodeId,
      columns: sel.column ? [sel.column] : [],
    }));
    lockWithSnapshots(snapshot);
  }, [nodeColumnSelections, nodeIdToName, lockWithSnapshots]);

  /**
   * Toggle lock state
   */
  const toggleLock = useCallback(() => {
    if (isLocked) {
      unlockSelection();
    } else {
      lockSelection();
    }
  }, [isLocked, lockSelection, unlockSelection]);

  /**
   * Get the active node IDs (locked snapshot or current selection)
   */
  const activeNodeIds = useMemo(() => {
    if (isLocked && lockedNodesSnapshot.length > 0) {
      return lockedNodesSnapshot.map((n) => n.id);
    }
    return selectedNodes.map((n) => n.id);
  }, [isLocked, lockedNodesSnapshot, selectedNodes]);

  /**
   * Get the primary active node ID (first in list)
   */
  const activeNodeId = useMemo(() => {
    return activeNodeIds[0] ?? '';
  }, [activeNodeIds]);

  /**
   * Get active node column selections (locked or current)
   */
  const activeNodeColumnSelections = useMemo(() => {
    if (isLocked && lockedNodesSnapshot.length > 0) {
      return lockedNodesSnapshot.map((n) => ({
        nodeId: n.id,
        column: n.columns[0] || '',
      }));
    }
    return nodeColumnSelections;
  }, [isLocked, lockedNodesSnapshot, nodeColumnSelections]);

  /**
   * Get display names for active nodes
   */
  const activeNodeNames = useMemo(() => {
    if (isLocked) {
      return lockedNodeNameMap;
    }
    return nodeIdToName;
  }, [isLocked, lockedNodeNameMap, nodeIdToName]);

  /**
   * Get the count to display in NodeSelectionPanel (locked vs current selection)
   */
  const displayNodeCount = useMemo(() => {
    if (isLocked && lockedNodesSnapshot.length > 0) {
      return lockedNodesSnapshot.length;
    }
    return selectedNodes.length;
  }, [isLocked, lockedNodesSnapshot, selectedNodes]);

  const panelSelectedNodes = useMemo<WorkspaceNodeLike[]>(() => {
    if (isLocked && lockedNodesSnapshot.length > 0) {
      return lockedNodesSnapshot.map((snapshot) => ({
        id: snapshot.id,
        name: snapshot.name,
        data: {
          id: snapshot.id,
          name: snapshot.name,
          nodeName: snapshot.name,
          label: snapshot.name,
          columns: snapshot.columns,
        },
        columns: snapshot.columns,
      }));
    }

    return selectedNodes as WorkspaceNodeLike[];
  }, [isLocked, lockedNodesSnapshot, selectedNodes]);

  return {
    // Lock state
    isLocked,
    setIsLocked,
    lockSelection,
  lockWithSnapshots,
    unlockSelection,
    toggleLock,

    // Node snapshots
    lockedNodesSnapshot,
    setLockedNodesSnapshot,

    // Node mappings
    nodeIdToName,
    lockedNodeNameMap,
    activeNodeNames,

    // Active resolution
    activeNodeIds,
    activeNodeId,
    activeNodeColumnSelections,

    // Display helpers
    displayNodeCount,
  panelSelectedNodes,

    // Column selection management
    nodeColumnSelections,
    setNodeColumnSelection,
    setNodeColumnSelections,
    recomputeAutoColumns,
  };
}

/**
 * Hook for managing parameter change detection in locked analysis tabs.
 * 
 * Tracks when analysis parameters have changed since locking, enabling
 * an "Update Results" button to re-run analysis with new parameters.
 * 
 * @param isLocked - Whether the analysis is currently locked
 * @param currentParams - Current parameter values
 * @param lockedParams - Snapshot of parameters when locked (or null)
 * @param compareFn - Optional custom comparison function
 * @returns Whether parameters have changed since locking
 */
export function useParameterChangeDetection<T extends Record<string, unknown>>(
  isLocked: boolean,
  currentParams: T,
  lockedParams: T | null,
  compareFn?: (current: T, locked: T) => boolean
): boolean {
  return useMemo(() => {
    if (!isLocked || !lockedParams) return false;

    if (compareFn) {
      return compareFn(currentParams, lockedParams);
    }

    // Default shallow comparison
    const currentKeys = Object.keys(currentParams);
    const lockedKeys = Object.keys(lockedParams);

    if (currentKeys.length !== lockedKeys.length) return true;

    return currentKeys.some((key) => {
      const current = currentParams[key];
      const locked = lockedParams[key];

      // Handle arrays
      if (Array.isArray(current) && Array.isArray(locked)) {
        if (current.length !== locked.length) return true;
        return current.some((val, idx) => val !== locked[idx]);
      }

      // Handle primitives
      return current !== locked;
    });
  }, [isLocked, currentParams, lockedParams, compareFn]);
}
