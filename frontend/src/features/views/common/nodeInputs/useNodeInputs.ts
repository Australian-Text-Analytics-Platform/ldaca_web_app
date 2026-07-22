import { useCallback, useMemo } from 'react';
import type { WorkspaceNodeMetadata } from '@/features/workspace/common/workspaceNodeMetadata';
import type { NodeColumnSelection } from '../nodeSelectionTypes';
import {
  type ColumnInfoGetter,
  type NodeAddRejection,
  type NodeInput,
  type NodeInputConstraints,
  type ResolvedNodeInput,
  buildNodeMap,
  defaultColumnForNode,
  resolveNodeInputs,
  validateAdd,
} from './nodeInputsCore';

export interface UseNodeInputsConfig {
  /** The persisted/owned input list (tab input set, store slice, or local state). */
  value: NodeInput[];
  /** Commit a new input list to the backing store. */
  onChange: (next: NodeInput[]) => void;
  /** Live workspace nodes — the source for resolution and the add picker. */
  allNodes: WorkspaceNodeMetadata[];
  /** Per-view constraints (allowed column types, max nodes, document-only). */
  constraints: NodeInputConstraints;
  /** Optional typed-column getter from ``useNodeColumnInfos`` for Arrow-derived kinds. */
  getColumnInfos?: ColumnInfoGetter;
}

export interface UseNodeInputsResult {
  /** Effective owner-provided inputs (may include ids not currently in the workspace). */
  inputs: NodeInput[];
  /** Inputs resolved against live nodes (stale dropped), with column options. */
  resolvedNodes: ResolvedNodeInput[];
  /** Convenience: just the resolved live nodes, in input order. */
  selectedNodes: WorkspaceNodeMetadata[];
  /** Convenience: {nodeId, column} pairs for request building / pickers. */
  nodeColumnSelections: NodeColumnSelection[];
  /** Live nodes not yet added (candidates for the Add control). */
  availableNodes: WorkspaceNodeMetadata[];
  /** Whether another node may be added under the max-nodes constraint. */
  canAddMore: boolean;
  /** Append nodes by id; returns rejections for ids that failed validation. */
  addNodes: (ids: string[]) => NodeAddRejection[];
  /** Returns why a node cannot be added right now, or null when it can. */
  getAddRejection: (id: string) => string | null;
  /** Remove one node from the inputs. */
  removeNode: (id: string) => void;
  /** Clear all inputs. */
  clear: () => void;
  /** Change the chosen column for an already-added node. */
  setColumn: (nodeId: string, column: string) => void;
}

/**
 * Backing-agnostic node-selection hook for the add-node-as-needed model.
 *
 * Owns no storage of its own: callers pass ``value``/``onChange`` bound to
 * whatever owns the draft inputs — an analysis tab component, the scoped
 * preprocessing inputs store, or plain ``useState``. Submitted inputs are
 * recovered from the backend's immutable Analysis request. This
 * keeps every view on one selection contract while letting draft ownership differ.
 *
 * Used by: ``useTabNodeInputs``, which supplies each named analysis or
 * preprocessing selector's effective value and needs a uniform
 * add/remove/clear/column surface plus a resolved display model.
 *
 * Flow: resolve the owner-provided effective inputs against live nodes
 * (dropping stale ids), then expose mutators that validate structural add-time
 * rules and commit via ``onChange``. The named owner applies restoration policy
 * before calling this hook; column type constraints only filter picker
 * options/defaults and do not block adding.
 */
export function useNodeInputs(config: UseNodeInputsConfig): UseNodeInputsResult {
  const { value, onChange, allNodes, constraints, getColumnInfos } = config;

  const nodeMap = useMemo(() => buildNodeMap(allNodes), [allNodes]);

  const resolvedNodes = useMemo(
    () => resolveNodeInputs(value, nodeMap, constraints, getColumnInfos),
    [value, nodeMap, constraints, getColumnInfos],
  );

  const selectedNodes = useMemo(() => resolvedNodes.map((r) => r.node), [resolvedNodes]);

  const nodeColumnSelections = useMemo<NodeColumnSelection[]>(
    () => resolvedNodes.map((r) => ({ nodeId: r.id, column: r.column })),
    [resolvedNodes],
  );

  const selectedIds = useMemo(() => new Set(value.map((i) => i.node_id)), [value]);

  const availableNodes = useMemo(
    () => allNodes.filter((node) => !selectedIds.has(node.id)),
    [allNodes, selectedIds],
  );

  const canAddMore = constraints.maxNodes == null || value.length < constraints.maxNodes;

  const addNodes = useCallback(
    (ids: string[]): NodeAddRejection[] => {
      const rejections: NodeAddRejection[] = [];
      const next = [...value];
      for (const id of ids) {
        const reason = validateAdd(id, next, nodeMap, constraints);
        if (reason) {
          rejections.push({ nodeId: id, reason });
          continue;
        }
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- validateAdd already confirmed the node exists in nodeMap
        const node = nodeMap.get(id)!;
        next.push({ node_id: id, column: defaultColumnForNode(node, constraints, getColumnInfos) });
      }
      if (next.length !== value.length) onChange(next);
      return rejections;
    },
    [value, nodeMap, constraints, getColumnInfos, onChange],
  );

  const getAddRejection = useCallback(
    (id: string): string | null => validateAdd(id, value, nodeMap, constraints),
    [value, nodeMap, constraints],
  );

  const removeNode = useCallback(
    (id: string) => {
      const next = value.filter((i) => i.node_id !== id);
      if (next.length !== value.length) onChange(next);
    },
    [value, onChange],
  );

  const clear = useCallback(() => {
    if (value.length) onChange([]);
  }, [value, onChange]);

  const setColumn = useCallback(
    (nodeId: string, column: string) => {
      let changed = false;
      const next = value.map((i) => {
        if (i.node_id === nodeId && i.column !== column) {
          changed = true;
          return { ...i, column };
        }
        return i;
      });
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- `changed` is mutated inside the map callback; TS control-flow analysis does not track the closure mutation
      if (changed) onChange(next);
    },
    [value, onChange],
  );

  return {
    inputs: value,
    resolvedNodes,
    selectedNodes,
    nodeColumnSelections,
    availableNodes,
    canAddMore,
    addNodes,
    getAddRejection,
    removeNode,
    clear,
    setColumn,
  };
}
