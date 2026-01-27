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
    hasActiveTask ||
    (isLocked && !allowRunWhenLocked);

  const clearDisabled =
    !hasWorkspace || (!hasResults && !isLocked && !hasActiveTask);

  return { runDisabled, clearDisabled };
};
