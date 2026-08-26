import { useCallback, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import type { WorkspaceNodeInfo } from '@/api';
import { useNodeColumnInfos } from '@/features/workspace/common/hooks/useNodeColumnInfos';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import {
  projectWorkspaceNodeMetadata,
  type WorkspaceNodeMetadata,
} from '@/features/workspace/common/workspaceNodeMetadata';
import type { ColumnInfo } from '@/features/workspace/data-view/utils/columnTypes';
import { useUIStore } from '@/stores';
import { useNodeInputRequestsStore } from '@/stores/nodeInputRequestsStore';
import {
  type AnalysisTabInput,
  type AnalysisTabInputSets,
  DEFAULT_TAB_INPUT_SET_ID,
  getTabInputSet,
} from '../tabs/tabStateOps';
import type { NodeInput, NodeInputConstraints } from './nodeInputsCore';
import { type UseNodeInputsResult, useNodeInputs } from './useNodeInputs';

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
  /** Current workspace id, for convenience. */
  workspaceId: string | null;
  /** Complete graph metadata for the currently selected input nodes, keyed by id. */
  nodeInfoById: Record<string, WorkspaceNodeInfo>;
  /** Returns cached typed columns for a selected input node, with snapshot fallback. */
  getColumnInfos: (node: WorkspaceNodeMetadata | null | undefined) => ColumnInfo[];
  /** Returns complete graph metadata for a selected input node when loaded. */
  getNodeInfo: (node: WorkspaceNodeMetadata | null | undefined) => WorkspaceNodeInfo | undefined;
}

export interface UseWorkspaceNodeInputsConfig {
  value: NodeInput[];
  onChange: (inputs: NodeInput[]) => void;
  constraints: NodeInputConstraints;
  /** Keep graph/sidebar add requests carried when a view has multiple placement targets. */
  deferNodeInputPlacement?: boolean;
}

/**
 * Binds a named analysis-tab input set to {@link useNodeInputs}, wiring in the
 * live workspace nodes and typed column metadata.
 *
 * Used by: the tabbed analysis-style ``*Feature`` components because each needs
 * the same plumbing (tab value/onChange + live nodes + column infos + graph
 * focus) to drive {@link NodeInputsPanel} and build run requests. Keeping it
 * here keeps each feature's binding a thin call instead of repeated wiring.
 *
 * Flow: resolve the requested selector id from ``input_sets``, delegate it to
 * ``useWorkspaceNodeInputs``, and expose the same callbacks to ``NodeInputsPanel``.
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
  const value = useMemo(
    () => getTabInputSet(tabInputSets ? { input_sets: tabInputSets } : undefined, selectorId),
    [selectorId, tabInputSets],
  );
  const onChange = useCallback(
    (nextInputs: AnalysisTabInput[]) => {
      onTabInputSetChange(selectorId, nextInputs);
    },
    [selectorId, onTabInputSetChange],
  );

  return useWorkspaceNodeInputs({
    value,
    onChange,
    constraints,
    deferNodeInputPlacement,
  });
}

/** Binds an owner-provided input list to live Workspace metadata and carried-input requests. */
export function useWorkspaceNodeInputs(
  config: UseWorkspaceNodeInputsConfig,
): UseTabNodeInputsResult {
  const { value, onChange, constraints, deferNodeInputPlacement = false } = config;
  const { nodes, currentWorkspaceId } = useWorkspaceData();
  const currentView = useUIStore((state) => state.currentView);
  const pendingInputRequests = useNodeInputRequestsStore((state) => state.pendingRequests);
  const consumeInputRequest = useNodeInputRequestsStore((state) => state.consume);

  // Typed columns for the already-selected nodes; getColumnInfos falls back to
  // the node snapshot for any node not in this query set (e.g. add candidates).
  const selectedGraphNodes = useMemo(() => {
    const ids = new Set(value.map((i) => i.node_id));
    return nodes.filter((node) => ids.has(node.id));
  }, [nodes, value]);

  const { getColumnInfos, getNodeInfo, nodeInfoById } = useNodeColumnInfos({
    workspaceId: currentWorkspaceId,
    nodes: selectedGraphNodes,
  });

  const allNodes = useMemo(() => nodes.map(projectWorkspaceNodeMetadata), [nodes]);

  const result = useNodeInputs({
    value,
    onChange,
    allNodes,
    constraints,
    getColumnInfos,
  });
  const { addNodes } = result;

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

  return {
    ...result,
    workspaceId: currentWorkspaceId ?? null,
    nodeInfoById,
    getColumnInfos,
    getNodeInfo,
  };
}
