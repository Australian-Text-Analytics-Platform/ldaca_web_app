import type { ClearAnalysisUiOptions } from './hooks/useAnalysisFeature';

interface ExecuteAnalysisRerunArgs {
  /** True when current parameters or inputs differ from the last completed run. */
  hasUnrunChanges: boolean;
  clearResults: (options?: ClearAnalysisUiOptions) => Promise<void>;
  runFreshAnalysis: () => Promise<void>;
  clearOptionsOnRerun?: ClearAnalysisUiOptions;
}

/**
 * Shared branch for the Run/Re-run button.
 *
 * Before a re-run, clear the previous task/result so the new request owns the
 * tab state; otherwise run directly. Keeps this clear-then-run behavior
 * consistent across analysis features without leaking old selection-model details.
 */
export const executeAnalysisRerun = async ({
  hasUnrunChanges,
  clearResults,
  runFreshAnalysis,
  clearOptionsOnRerun,
}: ExecuteAnalysisRerunArgs): Promise<void> => {
  if (hasUnrunChanges) {
    await clearResults(clearOptionsOnRerun);
  }

  await runFreshAnalysis();
};
