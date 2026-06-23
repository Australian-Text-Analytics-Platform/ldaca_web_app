import { useCallback, useEffect, useMemo } from 'react';
import type { AnalysisTabInput } from '@/api';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import { useWorkspaceSelection } from '@/features/workspace/common/hooks/useWorkspaceSelection';
import { useNodeColumnInfos } from '@/features/workspace/common/hooks/useNodeColumnInfos';
import { useNodeInputRequestsStore } from '@/stores/nodeInputRequestsStore';
import { useRecentSelectionsStore } from '@/stores/recentSelectionsStore';
import type { WorkspaceNodeLike } from '../nodeSelectionTypes';
import { getNodeDisplayName, getNodeIdentifier } from '../nodeSelectionTypes';
import type { NodeAddRejection, NodeInputConstraints } from './nodeInputsCore';
import { type UseNodeInputsResult, useNodeInputs } from './useNodeInputs';

/** A recently-used node group resolved against live workspace nodes for the "Add preset" list. */
export interface ResolvedPreset {
  /** All node ids in the recorded group (some may no longer exist / be addable). */
  ids: string[];
  /** Display names for the ids still present in the workspace, in order. */
  labels: string[];
  /** Subset of ``ids`` that can currently be added to this view. */
  addableIds: string[];
}

export interface UseTabNodeInputsConfig {
  /** The active tab's persisted inputs (from AnalysisTabsHost). */
  tabInputs?: AnalysisTabInput[];
  /** Commit a new input set for the active tab (persists to tabs.json). */
  onTabInputsChange?: (inputs: AnalysisTabInput[]) => void;
  /** Per-view constraints (allowed column types, max nodes, document-only). */
  constraints: NodeInputConstraints;
}

export interface UseTabNodeInputsResult extends UseNodeInputsResult {
  /** Node ids currently selected in the workspace graph (Add-from-graph source). */
  graphSelectedIds: string[];
  /** Current workspace id, for convenience. */
  workspaceId: string | null;
  /** Recently-used node groups, resolved against live nodes, for "Add preset". */
  recentPresets: ResolvedPreset[];
}

const NO_OP = () => {
  /* no-op fallback for an absent onChange handler */
};

/**
 * Binds an analysis tab's persisted ``inputs`` to {@link useNodeInputs}, wiring
 * in the live workspace nodes, typed column metadata, and the graph selection
 * used as the "Add from graph" source.
 *
 * Used by: the five tabbed analysis ``*Feature`` components because each needs
 * the same plumbing (tab value/onChange + live nodes + column infos + graph
 * focus) to drive {@link NodeInputsPanel} and build run requests. Keeping it
 * here makes each feature's migration a thin call instead of repeated wiring.
 *
 * Flow: read live nodes + graph selection, fetch typed columns for the already
 * selected nodes, then delegate to ``useNodeInputs`` with the tab's inputs as
 * the owned value.
 */
export function useTabNodeInputs(config: UseTabNodeInputsConfig): UseTabNodeInputsResult {
  const { tabInputs, onTabInputsChange, constraints } = config;
  const { nodes, currentWorkspaceId } = useWorkspaceData();
  const { selectedNodeIds } = useWorkspaceSelection();

  const allNodes = useMemo(() => nodes as WorkspaceNodeLike[], [nodes]);
  const value = useMemo(() => tabInputs ?? [], [tabInputs]);
  const onChange = onTabInputsChange ?? NO_OP;

  // Typed columns for the already-selected nodes; getColumnInfos falls back to
  // the node snapshot for any node not in this query set (e.g. add candidates).
  const selectedNodeObjs = useMemo(() => {
    const ids = new Set(value.map((i) => i.node_id));
    return allNodes.filter((node, idx) => ids.has(getNodeIdentifier(node, idx)));
  }, [allNodes, value]);

  const { getColumnInfos } = useNodeColumnInfos({
    workspaceId: currentWorkspaceId,
    nodes: selectedNodeObjs,
  });

  const result = useNodeInputs({
    value,
    onChange,
    allNodes,
    constraints,
    getColumnInfos,
  });

  // Recent presets: record the resulting input set after each add, and expose
  // the stored groups resolved against live nodes for the "Add preset" list.
  const recordRecent = useRecentSelectionsStore((s) => s.record);
  const recentGroups = useRecentSelectionsStore(
    (s) => s.byWorkspace[currentWorkspaceId ?? '__none__'],
  );
  const inputRequests = useNodeInputRequestsStore((s) => s.requests);
  const consumeInputRequest = useNodeInputRequestsStore((s) => s.consume);

  const baseAddNodes = result.addNodes;
  const addNodes = useCallback(
    (ids: string[]): NodeAddRejection[] => {
      const rejections = baseAddNodes(ids);
      const rejected = new Set(rejections.map((r) => r.nodeId));
      const accepted = ids.filter((id) => !rejected.has(id));
      if (accepted.length > 0) {
        const resulting = [...value.map((i) => i.node_id), ...accepted];
        recordRecent(currentWorkspaceId, resulting);
      }
      return rejections;
    },
    [baseAddNodes, value, recordRecent, currentWorkspaceId],
  );

  useEffect(() => {
    const matching = inputRequests.filter((request) => request.workspaceId === currentWorkspaceId);
    if (matching.length === 0) return;
    matching.forEach((request) => {
      addNodes(request.nodeIds);
      consumeInputRequest(request.id);
    });
  }, [inputRequests, currentWorkspaceId, addNodes, consumeInputRequest]);

  const nodeNameById = useMemo(() => {
    const map = new Map<string, string>();
    allNodes.forEach((node, idx) => {
      const id = getNodeIdentifier(node, idx);
      map.set(id, getNodeDisplayName(node, id));
    });
    return map;
  }, [allNodes]);

  const recentPresets = useMemo<ResolvedPreset[]>(() => {
    const currentIds = new Set(value.map((i) => i.node_id));
    return (
      (recentGroups ?? [])
        .map((ids) => {
          const labels = ids.flatMap((id) => {
            const label = nodeNameById.get(id);
            return label === undefined ? [] : [label];
          });
          const addableIds = ids.filter(
            (id) =>
              nodeNameById.has(id) && !currentIds.has(id) && result.getAddRejection(id) === null,
          );
          return { ids, labels, addableIds };
        })
        // Hide groups whose nodes have all vanished or are all already added.
        .filter((preset) => preset.labels.length > 0)
    );
  }, [recentGroups, nodeNameById, value, result]);

  return {
    ...result,
    addNodes,
    graphSelectedIds: selectedNodeIds,
    workspaceId: currentWorkspaceId ?? null,
    recentPresets,
  };
}
