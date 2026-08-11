/**
 * Pure, framework-free core for the per-view "add-node-as-needed" model.
 *
 * Each analysis tab / preprocessing subtab owns a list of {@link NodeInput}
 * records (a workspace ``node_id`` plus an optional ``column`` pick). These
 * helpers resolve that persisted list against the *live* workspace nodes,
 * validate whether a node may be added under a view's constraints, and pick a
 * sensible default column at add time. Keeping the logic here (not inside the
 * React hook) lets it be unit-tested without mounting components.
 *
 * Used by:
 * - ``useNodeInputs`` because the hook needs deterministic resolve/validate/
 *   default-column reducers before it commits changes to its backing store
 *   (tab input sets, the preprocessing inputs store, or local state).
 */
import type { ColumnInfo } from '@/features/workspace/data-view/utils/columnTypes';
import type { ArrowField } from '@/lib/arrow/arrowTable';
import type { WorkspaceNodeMetadata } from '@/features/workspace/common/workspaceNodeMetadata';

/** One node selected as input for a view. Mirrors backend ``AnalysisTabInput``. */
export interface NodeInput {
  node_id: string;
  column?: string | null;
}

export interface NodeSelectionInput {
  nodeId: string;
  column?: string | null;
}

/** Per-view constraints that gate which nodes/columns are valid inputs. */
export interface NodeInputConstraints {
  /**
   * Tests the decoded IPC field for compatibility with this view. Omit to
   * accept every Arrow field. This never blocks adding a node; an empty
   * filtered set leaves the selected column blank for the user to resolve.
   */
  fieldPredicate?: (field: ArrowField) => boolean;
  /** Maximum number of input nodes the view supports. Undefined = unbounded. */
  maxNodes?: number;
  /** When true, only a backend-declared document column is an acceptable pick. */
  docTypeOnly?: boolean;
}

/** A node resolved against the live workspace, ready for the selection panel. */
export interface ResolvedNodeInput {
  id: string;
  name: string;
  node: WorkspaceNodeMetadata;
  column: string;
  columnOptions: ColumnInfo[];
}

/** Why a requested add was refused, surfaced to the user in the Add control. */
export interface NodeAddRejection {
  nodeId: string;
  reason: string;
}

/** Optional typed-column getter from ``useNodeColumnInfos``. */
export type ColumnInfoGetter = (node: WorkspaceNodeMetadata) => ColumnInfo[] | undefined;

/**
 * Converts feature-local node/column selections into the persisted tab input shape.
 * Called by: analysis feature hydration and handoff paths that receive
 * `{nodeId, column}` selections from task requests, token-frequency handoff,
 * or generated node lists before committing them through `onTabInputSetChange`.
 */
export function nodeInputsFromSelections(selections: NodeSelectionInput[]): NodeInput[] {
  return selections
    .filter((selection) => selection.nodeId)
    .map((selection) => ({ node_id: selection.nodeId, column: selection.column ?? null }));
}

/**
 * Builds a node-id → live-node lookup from the workspace node list.
 * Called by: resolveNodeInputs and useNodeInputs add/validate paths because
 * every resolve/validate step needs O(1) access to the live node by id.
 */
export function buildNodeMap(
  allNodes: WorkspaceNodeMetadata[],
): Map<string, WorkspaceNodeMetadata> {
  const map = new Map<string, WorkspaceNodeMetadata>();
  allNodes.forEach((node) => {
    map.set(node.id, node);
  });
  return map;
}

/**
 * Computes the typed columns a view will accept for a node.
 * Called by: defaultColumnForNode, validateAdd, and resolveNodeInputs because
 * column options drive both add-time validation and the per-node picker.
 * Flow: read the authoritative Arrow-backed getter, then apply the feature's
 * predicate directly to each decoded field. An empty filtered set means the
 * column picker should render empty.
 */
function allowedColumnsForNode(
  node: WorkspaceNodeMetadata,
  constraints: NodeInputConstraints,
  getColumnInfos?: ColumnInfoGetter,
): ColumnInfo[] {
  const infos = getColumnInfos?.(node) ?? [];
  const { fieldPredicate } = constraints;
  if (!fieldPredicate) return infos;
  return infos.filter((column) => fieldPredicate(column.field));
}

/**
 * Picks the default column to store when a node is first added.
 * Called by: useNodeInputs.addNodes because a freshly added input should land
 * on the most likely-correct column without forcing a manual pick.
 * Flow: prefer the backend document column when present/allowed; otherwise the
 * first allowed column unless the view is document-only (then leave empty).
 */
export function defaultColumnForNode(
  node: WorkspaceNodeMetadata,
  constraints: NodeInputConstraints,
  getColumnInfos?: ColumnInfoGetter,
): string {
  const allowed = allowedColumnsForNode(node, constraints, getColumnInfos).map((c) => c.name);
  const documentColumn = node.document ?? '';
  if (documentColumn && allowed.includes(documentColumn)) return documentColumn;
  if (!constraints.docTypeOnly && allowed.length) return allowed[0] ?? '';
  return '';
}

/**
 * Validates whether ``nodeId`` may be structurally added to ``current``,
 * returning a rejection reason or null when the add is allowed.
 * Called by: useNodeInputs.addNodes for each requested id so the panel can
 * explain real add failures instead of silently dropping them.
 * Flow: existence → duplicate → capacity. Column compatibility is deliberately
 * not enforced here; the picker can render empty when no suitable column exists.
 */
export function validateAdd(
  nodeId: string,
  current: NodeInput[],
  nodeMap: Map<string, WorkspaceNodeMetadata>,
  constraints: NodeInputConstraints,
): string | null {
  const node = nodeMap.get(nodeId);
  if (!node) return 'Node is no longer in the workspace';
  if (current.some((i) => i.node_id === nodeId)) return 'Already added';
  if (constraints.maxNodes != null && current.length >= constraints.maxNodes) {
    return constraints.maxNodes === 1
      ? 'This view accepts a single node — remove the current one first'
      : `This view accepts at most ${String(constraints.maxNodes)} nodes`;
  }
  // Note: we intentionally do NOT reject nodes that lack a backend-declared
  // document column even when ``docTypeOnly`` is set. Any node may be added;
  // the user assigns its document column afterwards via the column picker
  // (that pick is what makes the document column exist in the first place).
  return null;
}

/**
 * Resolves persisted inputs against live nodes, dropping stale ids and
 * recomputing each node's column options + effective column for rendering.
 * Called by: useNodeInputs to derive the panel's display model every render.
 * Flow: for each input still present in the workspace, keep the stored column
 * when it remains valid, else fall back to a default pick so the picker never
 * shows a dangling value.
 */
export function resolveNodeInputs(
  inputs: NodeInput[],
  nodeMap: Map<string, WorkspaceNodeMetadata>,
  constraints: NodeInputConstraints,
  getColumnInfos?: ColumnInfoGetter,
): ResolvedNodeInput[] {
  const resolved: ResolvedNodeInput[] = [];
  for (const input of inputs) {
    const node = nodeMap.get(input.node_id);
    if (!node) continue;
    const columnOptions = allowedColumnsForNode(node, constraints, getColumnInfos);
    const optionNames = columnOptions.map((c) => c.name);
    const stored = input.column ?? '';
    const column =
      stored && optionNames.includes(stored)
        ? stored
        : defaultColumnForNode(node, constraints, getColumnInfos);
    resolved.push({
      id: input.node_id,
      name: node.name,
      node,
      column,
      columnOptions,
    });
  }
  return resolved;
}
