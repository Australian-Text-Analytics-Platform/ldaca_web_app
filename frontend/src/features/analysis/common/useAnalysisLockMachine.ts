import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { WorkspaceNodeLike } from '@/features/analysis/common/components/NodeSelectionPanel';
import { useWorkspaceSelection } from '@/features/workspace/common/hooks/useWorkspaceSelection';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
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
  storageScope?: string;
}

export interface LockedNodesSnapshot {
  id: string;
  name: string;
  columns: string[];
  shape?: [number | null, number | null] | number[];
}

export const useAnalysisLockCore = (config: AnalysisLockConfig) => {
  const {
    allowedDataTypes,
    maxNodes = 2,
    docTypeOnly = false,
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
    storageScope,
  });

  const nodeIdToName = (() => {
    const map: Record<string, string> = {};
    selectedNodes.forEach((n) => {
      const data = n.data as Record<string, unknown> | undefined;
      const name = n.name || data?.name || data?.label || data?.nodeName || n.id;
      map[n.id] = String(name);
    });
    return map;
  })();

  const lockedNodeNameMap = (() => {
    const map: Record<string, string> = {};
    lockedNodesSnapshot.forEach(({ id, name }) => {
      map[id] = name;
    });
    return map;
  })();

  const unlockSelection = () => {
    setIsLocked(false);
    setLockedNodesSnapshot([]);
  };

  const lockWithSnapshots = (
      snapshotInput:
        | Array<{ id: string; name?: string; columns?: string[] | null; shape?: [number | null, number | null] | number[] }>
        | { id: string; name?: string; columns?: string[] | null; shape?: [number | null, number | null] | number[] }
        | null
        | undefined
    ) => {
      if (!snapshotInput) {
        unlockSelection();
        return;
      }

      const snapshotArray = Array.isArray(snapshotInput) ? snapshotInput : [snapshotInput];
      const normalized: LockedNodesSnapshot[] = snapshotArray
        .filter((snap): snap is { id: string; name?: string; columns?: string[] | null; shape?: [number | null, number | null] | number[] } => Boolean(snap?.id))
        .map((snap) => ({
          id: snap.id,
          name: snap.name ?? snap.id,
          columns: Array.isArray(snap.columns)
            ? snap.columns.filter((col): col is string => typeof col === 'string')
            : [],
          shape: snap.shape,
        }));

      if (!normalized.length) {
        unlockSelection();
        return;
      }

      setLockedNodesSnapshot(normalized);
      setIsLocked(true);
    };

  const lockSelection = () => {
    const snapshot = nodeColumnSelections.map((sel) => {
      const node = selectedNodes.find((n) => n.id === sel.nodeId);
      return {
        id: sel.nodeId,
        name: nodeIdToName[sel.nodeId] || sel.nodeId,
        columns: sel.column ? [sel.column] : [],
        shape: (node as Record<string, unknown> | undefined)?.shape as [number | null, number | null] | number[] | undefined,
      };
    });
    lockWithSnapshots(snapshot);
  };

  const toggleLock = () => {
    if (isLocked) {
      unlockSelection();
    } else {
      lockSelection();
    }
  };

  const activeNodeIds = (() => {
    if (isLocked && lockedNodesSnapshot.length > 0) {
      return lockedNodesSnapshot.map((n) => n.id);
    }
    return selectedNodes.map((n) => n.id);
  })();

  const activeNodeId = activeNodeIds[0] ?? '';

  const activeNodeColumnSelections = (() => {
    if (isLocked && lockedNodesSnapshot.length > 0) {
      return lockedNodesSnapshot.map((n) => ({
        nodeId: n.id,
        column: n.columns[0] || '',
      }));
    }
    return nodeColumnSelections;
  })();

  const activeNodeNames = (() => {
    if (isLocked) {
      return lockedNodeNameMap;
    }
    return nodeIdToName;
  })();

  const displayNodeCount = (() => {
    if (isLocked && lockedNodesSnapshot.length > 0) {
      return lockedNodesSnapshot.length;
    }
    return selectedNodes.length;
  })();

  const panelSelectedNodes: WorkspaceNodeLike[] = (() => {
    if (isLocked && lockedNodesSnapshot.length > 0) {
      return lockedNodesSnapshot.map((snapshot) => {
        // The lock snapshot is intentionally narrow (id/name/columns/shape),
        // but downstream features (tokens-mode auto-pick, language inference)
        // need ``derived`` metadata too. Pull it from the live graph node when
        // the same id still exists in the workspace — falls back to undefined
        // when the source node has since been removed.
        const live = selectedNodes.find((n) => n.id === snapshot.id) as
          | Record<string, unknown>
          | undefined;
        return {
          id: snapshot.id,
          name: snapshot.name,
          shape: snapshot.shape,
          data: {
            id: snapshot.id,
            name: snapshot.name,
            nodeName: snapshot.name,
            label: snapshot.name,
            columns: snapshot.columns,
          },
          columns: snapshot.columns,
          derived: live?.derived,
          derived_columns: live?.derived_columns,
        };
      });
    }

    return selectedNodes as WorkspaceNodeLike[];
  })();

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
  const queryClient = useQueryClient();

  const captureSnapshotsForNodes = async (
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
          getAuthHeaders,
          queryClient,
        );
        return columnMap
          ? applySelectedColumnsToSnapshots(snapshots, columnMap)
          : snapshots;
      } catch (error) {
        console.error('Failed to capture node snapshots', error);
        return [];
      }
    };

  const lockWithCurrentNodes = async (columnMap?: Record<string, string>) => {
      const nodeIds = activeNodeIds;
      if (!nodeIds.length) {
        lockWithSnapshots(null);
        return;
      }
      const snapshots = await captureSnapshotsForNodes(nodeIds, columnMap);
      if (snapshots.length) {
        lockWithSnapshots(snapshots);
      }
    };

  return {
    ...lockState,
    captureSnapshotsForNodes,
    lockWithCurrentNodes,
  };
};
