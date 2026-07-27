import type { NodeColumnSelection } from './nodeSelectionTypes';
import { normalizeStringArray } from './parameterComparison';

/**
 * Run/Re-run button policy shared by every Analysis view.
 *
 * The owning Tab's attached Analysis, not Result availability, determines
 * whether the actions represent Run/Re-run and whether Clear is available.
 * Active Analyses cannot be replaced; failed and cancelled Analyses may be
 * retried unchanged; successful Analyses require changed inputs or parameters.
 */
export interface RerunActionStateInput {
  hasWorkspace: boolean;
  /** Inputs + any required params form a runnable request. */
  isRunnable: boolean;
  /** The backend Tab currently references a root Analysis. */
  hasAttachedAnalysis: boolean;
  /** Latest projected lifecycle state for the attached Analysis, when available. */
  analysisState: 'queued' | 'running' | 'successful' | 'failed' | 'cancelled' | null;
  /** Current params or node inputs differ from the last run. */
  hasChanges: boolean;
  isBusy?: boolean;
}

export interface RerunActionState {
  runDisabled: boolean;
  clearDisabled: boolean;
  runLabel: 'Run' | 'Re-run';
  runDisabledReason: string | undefined;
  clearDisabledReason: string | undefined;
}

/**
 * Derives the primary button label/disabled state and the clear-button state.
 * Called by: analysis features when rendering their run controls because the
 * Run vs Re-run decision must be identical across views.
 * Flow: invalid/busy/active → disabled; no attached Analysis → Run; failed or
 * cancelled Analysis → Re-run; successful Analysis → Re-run only after changes.
 */
export const getRerunActionState = ({
  hasWorkspace,
  isRunnable,
  hasAttachedAnalysis,
  analysisState,
  hasChanges,
  isBusy = false,
}: RerunActionStateInput): RerunActionState => {
  const runLabel: 'Run' | 'Re-run' = hasAttachedAnalysis ? 'Re-run' : 'Run';
  const isActiveAnalysis = analysisState === 'queued' || analysisState === 'running';
  const canRetryUnchanged = analysisState === 'failed' || analysisState === 'cancelled';
  const attachedStateUnavailable = hasAttachedAnalysis && analysisState === null;

  const runDisabled =
    !hasWorkspace ||
    !isRunnable ||
    isBusy ||
    isActiveAnalysis ||
    attachedStateUnavailable ||
    (hasAttachedAnalysis && !hasChanges && !canRetryUnchanged);

  const clearDisabled = !hasWorkspace || !hasAttachedAnalysis;
  const clearDisabledReason = !hasWorkspace
    ? 'Open a workspace first'
    : !hasAttachedAnalysis
      ? 'There are no results to clear'
      : undefined;

  const runDisabledReason: string | undefined = (() => {
    if (isBusy) return undefined;
    if (!hasWorkspace) return 'Open a workspace first';
    if (!isRunnable) return 'Add a data block and select a column to run';
    if (isActiveAnalysis) return 'The analysis is already queued or running';
    if (attachedStateUnavailable) return 'Clear the current analysis before running again';
    if (hasAttachedAnalysis && !hasChanges && !canRetryUnchanged) {
      return 'Change a parameter or the selection to re-run';
    }
    return undefined;
  })();

  return { runDisabled, clearDisabled, runLabel, runDisabledReason, clearDisabledReason };
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
 * whether a successful Analysis has an enabled "Re-run".
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
