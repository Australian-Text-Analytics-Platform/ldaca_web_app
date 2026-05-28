export type AnalysisActionStateInput = {
  hasWorkspace: boolean;
  hasSelection: boolean;
  isLocked: boolean;
  hasResults: boolean;
  isBusy?: boolean;
  hasActiveTask?: boolean;
  allowRunWhenLocked?: boolean;
  /** True for tools that support re-running via parameter change (shows "or change parameters" hint) */
  canUpdate?: boolean;
};

export type AnalysisActionState = {
  runDisabled: boolean;
  clearDisabled: boolean;
  runLabel: 'Run' | 'Update';
  runDisabledReason: string | undefined;
};

/**
 * Centralizes run/clear button policy so every analysis feature presents the
 * same disabled states while task locks or active tasks own the current result.
 * Used by: analysis feature screens when deriving Run/Update/Clear button state because each panel needs lock-aware labels, disabled state, and guidance text from the same policy.
 * Flow: combine workspace/selection, busy, lock, active-task, and update flags; derive run/clear disabled states and labels; then return the button contract.
 */
export const getAnalysisActionState = ({
  hasWorkspace,
  hasSelection,
  isLocked,
  hasResults,
  isBusy = false,
  hasActiveTask = false,
  allowRunWhenLocked = false,
  canUpdate = false,
}: AnalysisActionStateInput): AnalysisActionState => {
  const runDisabled =
    !hasWorkspace ||
    !hasSelection ||
    isBusy ||
    ((isLocked || hasActiveTask) && !allowRunWhenLocked);

  const clearDisabled =
    !hasWorkspace || (!hasResults && !isLocked && !hasActiveTask);

  const runLabel: 'Run' | 'Update' = allowRunWhenLocked ? 'Update' : 'Run';

  const runDisabledReason: string | undefined = (() => {
    if (isBusy) return undefined;
    if (!hasWorkspace) return 'Open a workspace first';
    if (!hasSelection) return 'Select a data block and column to run';
    if ((isLocked || hasActiveTask) && !allowRunWhenLocked)
      return canUpdate
        ? 'Clear results first to run a new analysis, or change parameters to update the current results'
        : 'Clear results first to run a new analysis';
    return undefined;
  })();

  return { runDisabled, clearDisabled, runLabel, runDisabledReason };
};
