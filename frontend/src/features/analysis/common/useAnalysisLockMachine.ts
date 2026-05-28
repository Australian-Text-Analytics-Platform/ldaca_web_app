import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { WorkspaceNodeLike } from '@/features/analysis/common/components/NodeSelectionPanel';
import { useWorkspaceSelection } from '@/features/workspace/common/hooks/useWorkspaceSelection';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import { useNodeColumnInfos } from '@/hooks/useNodeColumnInfos';
import { useAutoNodeColumns } from '@/hooks/useAutoNodeColumns';
import { applySelectedColumnsToSnapshots, createNodeSnapshots } from '@/hooks/useSchemaManagement';

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

/**
 * Owns the local lock snapshot state that lets analysis tabs freeze selections
 * while results are displayed or restored from an existing backend task.
 * Used by: useAnalysisLockMachine and unit tests for analysis lock state because callers need shared hook state and handlers without duplicating analysis lifecycle wiring.
 * Flow: read caller config, derive local analysis state, call store/API helpers as needed, then return state and handlers to the feature.
 */
export const useAnalysisLockCore = (config: AnalysisLockConfig) => {
  const { allowedDataTypes, maxNodes = 2, docTypeOnly = false, storageScope } = config;

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

  /** Called by: clear flows, toggleLock, and invalid snapshot restoration because the caller needs this analysis-specific step before continuing its request, result, display, or cleanup workflow. */
  const unlockSelection = () => {
    setIsLocked(false);
    setLockedNodesSnapshot([]);
  };

  /**
   * Replaces live selections with persisted node snapshots supplied by task
   * hydration, task request restoration, or a fresh lock action.
   * Called by: lockSelection, lockWithCurrentNodes, and hydration restore helpers because the caller needs this analysis-specific step before continuing its request, result, display, or cleanup workflow.
   * Flow: normalize inputs, derive state, then return the analysis result expected by callers.
   */
  const lockWithSnapshots = (
    snapshotInput:
      | Array<{
          id: string;
          name?: string;
          columns?: string[] | null;
          shape?: [number | null, number | null] | number[];
        }>
      | {
          id: string;
          name?: string;
          columns?: string[] | null;
          shape?: [number | null, number | null] | number[];
        }
      | null
      | undefined,
  ) => {
    if (!snapshotInput) {
      unlockSelection();
      return;
    }

    const snapshotArray = Array.isArray(snapshotInput) ? snapshotInput : [snapshotInput];
    const normalized: LockedNodesSnapshot[] = snapshotArray
      .filter(
        (
          snap,
        ): snap is {
          id: string;
          name?: string;
          columns?: string[] | null;
          shape?: [number | null, number | null] | number[];
        } => Boolean(snap?.id),
      )
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

  /**
   * Called by: toggleLock and feature run handlers before starting a new task because the caller needs this analysis-specific step before continuing its request, result, display, or cleanup workflow.
   * Flow: derive display state, bind user actions, then render the analysis UI.
   */
  const lockSelection = () => {
    const snapshot = nodeColumnSelections.map((sel) => {
      const node = selectedNodes.find((n) => n.id === sel.nodeId);
      return {
        id: sel.nodeId,
        name: nodeIdToName[sel.nodeId] || sel.nodeId,
        columns: sel.column ? [sel.column] : [],
        shape: (node as Record<string, unknown> | undefined)?.shape as
          | [number | null, number | null]
          | number[]
          | undefined,
      };
    });
    lockWithSnapshots(snapshot);
  };

  /** Called by: analysis panel controls that expose a manual lock/unlock action because the caller needs this analysis-specific step before continuing its request, result, display, or cleanup workflow. */
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
        // but downstream features (tokens-mode auto-pick) need saved tokenizer
        // models too. Pull them from the live graph node when
        // the same id still exists in the workspace — falls back to undefined
        // when the source node has since been removed.
        const live = selectedNodes.find((n) => n.id === snapshot.id) as
          | Record<string, unknown>
          | undefined;
        const tokenizerModels = live?.tokenizer_models;
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
          tokenizer_models:
            tokenizerModels && typeof tokenizerModels === 'object'
              ? (tokenizerModels as Record<string, string>)
              : undefined,
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

/**
 * Extends the local lock core with workspace-aware snapshot capture so features
 * can restore selected columns from cached node metadata or backend task payloads.
 * Used by: useAnalysisLock and analysis feature screens with direct lock-machine needs.
 * Flow: read caller config, derive local analysis state, call store/API helpers as needed, then return state and handlers to the feature.
 */
export const useAnalysisLockMachine = (config: UseAnalysisLockMachineConfig) => {
  const { workspaceId = null, getAuthHeaders = () => ({}), ...lockConfig } = config;

  const lockState = useAnalysisLockCore(lockConfig);
  const { activeNodeIds, lockWithSnapshots } = lockState;
  const queryClient = useQueryClient();

  /**
   * Reads node metadata through the shared query cache before locking ids that
   * came from restored task requests or current workspace selections.
   * Called by: lockWithCurrentNodes and restoreAnalysisLockFromRequest consumers because the caller needs this analysis-specific step before continuing its request, result, display, or cleanup workflow.
   */
  const captureSnapshotsForNodes = async (
    nodeIds: string[],
    columnMap?: Record<string, string>,
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
      return columnMap ? applySelectedColumnsToSnapshots(snapshots, columnMap) : snapshots;
    } catch (error) {
      console.error('Failed to capture node snapshots', error);
      return [];
    }
  };

  /** Called by: analysis feature run handlers that need fresh snapshot data because locks should capture current node snapshots before the request mutates result state. */
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
