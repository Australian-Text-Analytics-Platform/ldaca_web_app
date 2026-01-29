import { useCallback, useMemo, useState } from 'react';
import type { WorkspaceNodeLike } from '@/components/NodeSelectionPanel';
import { useWorkspaceSelection } from '@/hooks/useWorkspaceSelection';
import { useWorkspaceData } from '@/hooks/useWorkspaceData';
import { useNodeColumnInfos } from '@/hooks/useNodeColumnInfos';
import { useAutoNodeColumns } from '@/hooks/useAutoNodeColumns';
import {
  applySelectedColumnsToSnapshots,
  createNodeSnapshots,
} from '@/hooks/useSchemaManagement';

export interface AnalysisLockConfig {
  allowedDataTypes: string[];
  maxNodes?: number;
  docTypeOnly?: boolean;
  enableHeuristicGuess?: boolean;
  storageScope?: string;
}

export interface LockedNodesSnapshot {
  id: string;
  name: string;
  columns: string[];
}

export const useAnalysisLockCore = (config: AnalysisLockConfig) => {
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

  const [isLocked, setIsLocked] = useState(false);
  const [lockedNodesSnapshot, setLockedNodesSnapshot] = useState<LockedNodesSnapshot[]>([]);

  const {
    selections: nodeColumnSelections,
    setSelection: setNodeColumnSelection,
    setSelections: setNodeColumnSelections,
    recomputeAutoColumns,
  } = useAutoNodeColumns({
    selectedNodes,
    getNodeColumns: getColumnInfos,
    allowedDataTypes,
    workspaceId: currentWorkspaceId,
    maxNodes,
    isLocked,
    docTypeOnly,
    enableHeuristicGuess,
    storageScope,
  });

  const nodeIdToName = useMemo(() => {
    const map: Record<string, string> = {};
    selectedNodes.forEach((n) => {
      const name = n.name || n.data?.name || n.data?.label || n.data?.nodeName || n.id;
      map[n.id] = String(name);
    });
    return map;
  }, [selectedNodes]);

  const lockedNodeNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    lockedNodesSnapshot.forEach(({ id, name }) => {
      map[id] = name;
    });
    return map;
  }, [lockedNodesSnapshot]);

  const unlockSelection = useCallback(() => {
    setIsLocked(false);
    setLockedNodesSnapshot([]);
  }, []);

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
    [unlockSelection]
  );

  const lockSelection = useCallback(() => {
    const snapshot = nodeColumnSelections.map((sel) => ({
      id: sel.nodeId,
      name: nodeIdToName[sel.nodeId] || sel.nodeId,
      columns: sel.column ? [sel.column] : [],
    }));
    lockWithSnapshots(snapshot);
  }, [nodeColumnSelections, nodeIdToName, lockWithSnapshots]);

  const toggleLock = useCallback(() => {
    if (isLocked) {
      unlockSelection();
    } else {
      lockSelection();
    }
  }, [isLocked, lockSelection, unlockSelection]);

  const activeNodeIds = useMemo(() => {
    if (isLocked && lockedNodesSnapshot.length > 0) {
      return lockedNodesSnapshot.map((n) => n.id);
    }
    return selectedNodes.map((n) => n.id);
  }, [isLocked, lockedNodesSnapshot, selectedNodes]);

  const activeNodeId = useMemo(() => activeNodeIds[0] ?? '', [activeNodeIds]);

  const activeNodeColumnSelections = useMemo(() => {
    if (isLocked && lockedNodesSnapshot.length > 0) {
      return lockedNodesSnapshot.map((n) => ({
        nodeId: n.id,
        column: n.columns[0] || '',
      }));
    }
    return nodeColumnSelections;
  }, [isLocked, lockedNodesSnapshot, nodeColumnSelections]);

  const activeNodeNames = useMemo(() => {
    if (isLocked) {
      return lockedNodeNameMap;
    }
    return nodeIdToName;
  }, [isLocked, lockedNodeNameMap, nodeIdToName]);

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
    isLocked,
    setIsLocked,
    lockSelection,
    lockWithSnapshots,
    unlockSelection,
    toggleLock,
    lockedNodesSnapshot,
    setLockedNodesSnapshot,
    nodeIdToName,
    lockedNodeNameMap,
    activeNodeNames,
    activeNodeIds,
    activeNodeId,
    activeNodeColumnSelections,
    displayNodeCount,
    panelSelectedNodes,
    nodeColumnSelections,
    setNodeColumnSelection,
    setNodeColumnSelections,
    recomputeAutoColumns,
  };
};

export type AnalysisLockState = ReturnType<typeof useAnalysisLockCore>;

export interface UseAnalysisLockMachineConfig extends AnalysisLockConfig {
  workspaceId?: string | null;
  getAuthHeaders?: () => Record<string, string>;
}

export const useAnalysisLockMachine = (config: UseAnalysisLockMachineConfig) => {
  const {
    workspaceId = null,
    getAuthHeaders = () => ({}),
    ...lockConfig
  } = config;

  const lockState = useAnalysisLockCore(lockConfig);
  const { activeNodeIds, lockWithSnapshots } = lockState;

  const captureSnapshotsForNodes = useCallback(
    async (
      nodeIds: string[],
      columnMap?: Record<string, string>
    ) => {
      if (!workspaceId || !Array.isArray(nodeIds) || nodeIds.length === 0) {
        return [];
      }

      try {
        const snapshots = await createNodeSnapshots(
          workspaceId,
          nodeIds,
          getAuthHeaders
        );
        return columnMap
          ? applySelectedColumnsToSnapshots(snapshots, columnMap)
          : snapshots;
      } catch (error) {
        console.error('Failed to capture node snapshots', error);
        return [];
      }
    },
    [workspaceId, getAuthHeaders]
  );

  const lockWithCurrentNodes = useCallback(
    async (columnMap?: Record<string, string>) => {
      const nodeIds = activeNodeIds;
      if (!nodeIds.length) {
        lockWithSnapshots(null);
        return;
      }
      const snapshots = await captureSnapshotsForNodes(nodeIds, columnMap);
      if (snapshots.length) {
        lockWithSnapshots(snapshots);
      }
    },
    [captureSnapshotsForNodes, activeNodeIds, lockWithSnapshots]
  );

  return {
    ...lockState,
    captureSnapshotsForNodes,
    lockWithCurrentNodes,
  };
};
