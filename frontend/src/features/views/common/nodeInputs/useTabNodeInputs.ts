import { useCallback, useEffect, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import type { WorkspaceNodeInfo } from '@/api';
import { useNodeColumnInfos } from '@/features/workspace/common/hooks/useNodeColumnInfos';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import { useWorkspaceSelection } from '@/features/workspace/common/hooks/useWorkspaceSelection';
import {
  projectWorkspaceNodeMetadata,
  type WorkspaceNodeMetadata,
} from '@/features/workspace/common/workspaceNodeMetadata';
import type { ColumnInfo } from '@/features/workspace/data-view/utils/columnTypes';
import { useUIStore } from '@/stores';
import { useAuthStore } from '@/stores/authStore';
import { useNodeInputRequestsStore } from '@/stores/nodeInputRequestsStore';
import { recentSelectionsScopeKey, useRecentSelectionsStore } from '@/stores/recentSelectionsStore';
import {
  type AnalysisTabInput,
  type AnalysisTabInputSets,
  DEFAULT_TAB_INPUT_SET_ID,
  getTabInputSet,
} from '../tabs/tabStateOps';
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
  /** Selector id within the active tab; defaults to the source selector. */
  selectorId?: string;
  /** All named input sets for the active tab. */
  tabInputSets?: AnalysisTabInputSets;
  /** Commit one named draft input set for the active client tab. */
  onTabInputSetChange: (selectorId: string, inputs: AnalysisTabInput[]) => void;
  /** Per-view constraints (allowed column types, max nodes, document-only). */
  constraints: NodeInputConstraints;
  /** Keep graph/sidebar add requests on the pointer when this view has multiple placement areas. */
  deferNodeInputPlacement?: boolean;
}

export interface UseTabNodeInputsResult extends UseNodeInputsResult {
  /** Node ids currently selected in the workspace graph (Add-from-graph source). */
  graphSelectedIds: string[];
  /** Current workspace id, for convenience. */
  workspaceId: string | null;
  /** Recently-used node groups, resolved against live nodes, for "Add preset". */
  recentPresets: ResolvedPreset[];
  /** Complete graph metadata for the currently selected input nodes, keyed by id. */
  nodeInfoById: Record<string, WorkspaceNodeInfo>;
  /** Returns cached typed columns for a selected input node, with snapshot fallback. */
  getColumnInfos: (node: WorkspaceNodeMetadata | null | undefined) => ColumnInfo[];
  /** Returns complete graph metadata for a selected input node when loaded. */
  getNodeInfo: (node: WorkspaceNodeMetadata | null | undefined) => WorkspaceNodeInfo | undefined;
}

/**
 * Binds a named analysis-tab input set to {@link useNodeInputs}, wiring in the
 * live workspace nodes, typed column metadata, and the graph selection used as
 * the "Add from graph" source.
 *
 * Used by: the tabbed analysis-style ``*Feature`` components because each needs
 * the same plumbing (tab value/onChange + live nodes + column infos + graph
 * focus) to drive {@link NodeInputsPanel} and build run requests. Keeping it
 * here keeps each feature's binding a thin call instead of repeated wiring.
 *
 * Flow: resolve the requested selector id from ``input_sets``, cap restored
 * state once at this named owner and persist that normalization, fetch metadata
 * only for the stable effective inputs, delegate those same inputs to
 * ``useNodeInputs``, and expose the same callbacks to ``NodeInputsPanel``.
 * Single-selector views consume matching graph/sidebar requests immediately;
 * multi-selector views defer placement so the user can choose a target panel.
 */
export function useTabNodeInputs(config: UseTabNodeInputsConfig): UseTabNodeInputsResult {
  const {
    selectorId = DEFAULT_TAB_INPUT_SET_ID,
    tabInputSets,
    onTabInputSetChange,
    constraints,
    deferNodeInputPlacement = false,
  } = config;
  const { nodes, currentWorkspaceId } = useWorkspaceData();
  const currentView = useUIStore((state) => state.currentView);
  const userId = useAuthStore((state) => state.session?.user?.id ?? '__anonymous__');
  const { selectedNodeIds } = useWorkspaceSelection();
  const pendingInputRequests = useNodeInputRequestsStore((state) => state.pendingRequests);
  const consumeInputRequest = useNodeInputRequestsStore((state) => state.consume);

  const value = useMemo(
    () => getTabInputSet(tabInputSets ? { input_sets: tabInputSets } : undefined, selectorId),
    [selectorId, tabInputSets],
  );
  const maxNodes = constraints.maxNodes;
  // This memo is an identity contract, not a render optimization: while the
  // backing owner reconciles restored over-limit state, metadata hydration and
  // every low-level selector callback must share one stable capped array.
  const effectiveValue = useMemo(
    () => (maxNodes != null && value.length > maxNodes ? value.slice(-maxNodes) : value),
    [maxNodes, value],
  );
  const onChange = useCallback(
    (nextInputs: AnalysisTabInput[]) => {
      onTabInputSetChange(selectorId, nextInputs);
    },
    [selectorId, onTabInputSetChange],
  );
  const normalizationSnapshot = JSON.stringify({
    workspaceId: currentWorkspaceId ?? null,
    selectorId,
    maxNodes: maxNodes ?? null,
    inputs: value.map((input) => [input.node_id, input.column ?? null]),
  });
  const lastNormalizedSnapshotRef = useRef<string | null>(null);

  // Triggered by restored input or owner changes. Flow: clear the dedupe marker
  // after reconciliation, skip StrictMode/callback replays of the same content
  // snapshot, otherwise record before issuing the single owner write.
  useEffect(() => {
    if (effectiveValue === value) {
      lastNormalizedSnapshotRef.current = null;
      return;
    }
    if (lastNormalizedSnapshotRef.current === normalizationSnapshot) return;

    lastNormalizedSnapshotRef.current = normalizationSnapshot;
    onChange(effectiveValue);
  }, [effectiveValue, normalizationSnapshot, onChange, value]);

  // Typed columns for the already-selected nodes; getColumnInfos falls back to
  // the node snapshot for any node not in this query set (e.g. add candidates).
  const selectedGraphNodes = useMemo(() => {
    const ids = new Set(effectiveValue.map((i) => i.node_id));
    return nodes.filter((node) => ids.has(node.id));
  }, [nodes, effectiveValue]);

  const { getColumnInfos, getNodeInfo, nodeInfoById } = useNodeColumnInfos({
    workspaceId: currentWorkspaceId,
    nodes: selectedGraphNodes,
  });

  const allNodes = useMemo(() => nodes.map(projectWorkspaceNodeMetadata), [nodes]);

  const result = useNodeInputs({
    value: effectiveValue,
    onChange,
    allNodes,
    constraints,
    getColumnInfos,
  });

  // Recent presets: record the resulting input set after each add, and expose
  // the stored groups resolved against live nodes for the "Add preset" list.
  const recordRecent = useRecentSelectionsStore((s) => s.record);
  const recentGroups = useRecentSelectionsStore(
    (s) => s.byScope[recentSelectionsScopeKey(userId, currentWorkspaceId)],
  );
  const baseAddNodes = result.addNodes;
  const effectiveInputs = result.inputs;
  const addNodes = useCallback(
    (ids: string[]): NodeAddRejection[] => {
      const rejections = baseAddNodes(ids);
      const rejected = new Set(rejections.map((r) => r.nodeId));
      const accepted = ids.filter((id) => !rejected.has(id));
      if (accepted.length > 0) {
        const resulting = [...effectiveInputs.map((i) => i.node_id), ...accepted];
        recordRecent(userId, currentWorkspaceId, resulting);
      }
      return rejections;
    },
    [baseAddNodes, effectiveInputs, recordRecent, userId, currentWorkspaceId],
  );

  // A stable addNodes identity is required here: this effect should respond to
  // new carried requests, not replay unchanged requests after unrelated renders.
  useEffect(() => {
    if (deferNodeInputPlacement || !currentWorkspaceId) return;
    const pendingIds = new Set(
      useNodeInputRequestsStore.getState().pendingRequests.map((request) => request.id),
    );
    const matchingRequests = pendingInputRequests.filter(
      (request) =>
        pendingIds.has(request.id) &&
        request.workspaceId === currentWorkspaceId &&
        request.view === currentView,
    );
    if (matchingRequests.length === 0) return;

    const rejections = addNodes(matchingRequests.map((request) => request.nodeId));
    if (rejections.length === 1) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- length===1 guarantees index 0 exists
      toast.warning(`Couldn't add node: ${rejections[0]!.reason}`);
    } else if (rejections.length > 1) {
      toast.warning(`Couldn't add ${String(rejections.length)} nodes (already added or full).`);
    }
    matchingRequests.forEach((request) => {
      consumeInputRequest(request.id);
    });
  }, [
    addNodes,
    consumeInputRequest,
    currentView,
    currentWorkspaceId,
    deferNodeInputPlacement,
    pendingInputRequests,
  ]);

  const nodeNameById = useMemo(() => {
    const map = new Map<string, string>();
    allNodes.forEach((node) => {
      map.set(node.id, node.name);
    });
    return map;
  }, [allNodes]);

  const recentPresets = useMemo<ResolvedPreset[]>(() => {
    const currentIds = new Set(effectiveInputs.map((i) => i.node_id));
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
  }, [recentGroups, nodeNameById, effectiveInputs, result]);

  return {
    ...result,
    addNodes,
    graphSelectedIds: selectedNodeIds,
    workspaceId: currentWorkspaceId ?? null,
    recentPresets,
    nodeInfoById,
    getColumnInfos,
    getNodeInfo,
  };
}
