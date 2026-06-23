import type { NodeColumnSelection } from './nodeSelectionTypes';
import { normalizeStringArray } from './parameterComparison';

/**
 * Run/Re-run button policy for the add-node-as-needed model.
 *
 * There is no locking: parameters and node selection are always editable. The
 * button is gated purely by whether anything differs from the last run:
 *
 *   - No last run yet           -> "Run", enabled when inputs + params are valid.
 *   - Last run, nothing changed -> disabled (re-running would be a no-op).
 *   - Last run, something changed-> "Re-run", enabled.
 *
 * Used by: every analysis ``*Feature`` to derive its primary action button and
 * the clear button, so all views share one consistent post-run experience.
 */
export interface RerunActionStateInput {
  hasWorkspace: boolean;
  /** Inputs + any required params form a runnable request. */
  isRunnable: boolean;
  /** A task result currently exists / a run has happened for this tab. */
  hasLastRun: boolean;
  /** Current params or node inputs differ from the last run. */
  hasChanges: boolean;
  isBusy?: boolean;
  hasResults?: boolean;
}

export interface RerunActionState {
  runDisabled: boolean;
  clearDisabled: boolean;
  runLabel: 'Run' | 'Re-run';
  runDisabledReason: string | undefined;
}

/**
 * Derives the primary button label/disabled state and the clear-button state.
 * Called by: analysis features when rendering their run controls because the
 * Run vs Re-run decision must be identical across views.
 * Flow: invalid/busy → disabled Run; valid + no prior run → enabled Run;
 * prior run + changes → enabled Re-run; prior run + no changes → disabled.
 */
export const getRerunActionState = ({
  hasWorkspace,
  isRunnable,
  hasLastRun,
  hasChanges,
  isBusy = false,
  hasResults = false,
}: RerunActionStateInput): RerunActionState => {
  const runLabel: 'Run' | 'Re-run' = hasLastRun ? 'Re-run' : 'Run';

  const runDisabled = !hasWorkspace || !isRunnable || isBusy || (hasLastRun && !hasChanges);

  const clearDisabled = !hasWorkspace || !hasResults;

  const runDisabledReason: string | undefined = (() => {
    if (isBusy) return undefined;
    if (!hasWorkspace) return 'Open a workspace first';
    if (!isRunnable) return 'Add a data block and select a column to run';
    if (hasLastRun && !hasChanges) return 'Change a parameter or the selection to re-run';
    return undefined;
  })();

  return { runDisabled, clearDisabled, runLabel, runDisabledReason };
};

/** A request's node selection, normalized for order-independent comparison. */
interface NodeSelectionSignature {
  nodeIds: string[];
  nodeColumns: Record<string, string>;
}

/**
 * Builds an order-independent signature of the current node inputs.
 * Called by: hasNodeSelectionChanged so adding/removing/re-columning a node
 * flips the button to "Re-run" without false positives from ordering.
 */
const nodeSelectionSignature = (selections: NodeColumnSelection[]): NodeSelectionSignature => {
  const nodeIds = normalizeStringArray(selections.map((s) => s.nodeId));
  const nodeColumns: Record<string, string> = {};
  selections.forEach((s) => {
    if (s.nodeId) nodeColumns[s.nodeId] = s.column;
  });
  return { nodeIds, nodeColumns };
};

/**
 * True when the current node inputs differ from the last run's node selection.
 * Called by: analysis features (combined with parameter diffing) to decide
 * whether the primary button is an enabled "Re-run".
 * Flow: compare normalized node id sets, then per-node column picks.
 */
export const hasNodeSelectionChanged = (
  current: NodeColumnSelection[],
  serverNodeIds: string[] | undefined,
  serverNodeColumns: Record<string, string | undefined> | undefined,
): boolean => {
  const cur = nodeSelectionSignature(current);
  const srvIds = normalizeStringArray(serverNodeIds ?? []);
  if (cur.nodeIds.length !== srvIds.length || cur.nodeIds.some((id, i) => id !== srvIds[i])) {
    return true;
  }
  return cur.nodeIds.some((id) => (cur.nodeColumns[id] ?? '') !== (serverNodeColumns?.[id] ?? ''));
};
