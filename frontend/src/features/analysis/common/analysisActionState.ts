export type AnalysisActionStateInput = {
  hasWorkspace: boolean;
  hasSelection: boolean;
  isLocked: boolean;
  hasResults: boolean;
  isBusy?: boolean;
  hasActiveTask?: boolean;
  allowRunWhenLocked?: boolean;
};

export type AnalysisActionState = {
  runDisabled: boolean;
  clearDisabled: boolean;
  runLabel: 'Run' | 'Update';
};

export const getAnalysisActionState = ({
  hasWorkspace,
  hasSelection,
  isLocked,
  hasResults,
  isBusy = false,
  hasActiveTask = false,
  allowRunWhenLocked = false,
}: AnalysisActionStateInput): AnalysisActionState => {
  const runDisabled =
    !hasWorkspace ||
    !hasSelection ||
    isBusy ||
    ((isLocked || hasActiveTask) && !allowRunWhenLocked);

  const clearDisabled =
    !hasWorkspace || (!hasResults && !isLocked && !hasActiveTask);

  const runLabel: 'Run' | 'Update' = allowRunWhenLocked ? 'Update' : 'Run';

  return { runDisabled, clearDisabled, runLabel };
};
