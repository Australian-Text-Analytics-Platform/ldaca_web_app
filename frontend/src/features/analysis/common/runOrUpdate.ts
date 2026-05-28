import type { ClearAnalysisUiOptions } from './hooks/useAnalysisFeature';

interface ExecuteAnalysisRunOrUpdateArgs {
  hasLockedParameterChanges: boolean;
  clearResults: (options?: ClearAnalysisUiOptions) => Promise<void>;
  runFreshAnalysis: () => Promise<void>;
  clearOptionsOnUpdate?: ClearAnalysisUiOptions;
}

/**
 * Gives analysis feature submit handlers one shared branch for rerunning a task
 * after locked parameters changed, so panels do not duplicate clear-then-run behavior.
 * Used by: analysis submit handlers with update-after-lock flows because they need one clear-then-run branch when submitted parameters differ from locked results.
 */
export const executeAnalysisRunOrUpdate = async ({
  hasLockedParameterChanges,
  clearResults,
  runFreshAnalysis,
  clearOptionsOnUpdate,
}: ExecuteAnalysisRunOrUpdateArgs): Promise<void> => {
  if (hasLockedParameterChanges) {
    await clearResults(clearOptionsOnUpdate);
  }

  await runFreshAnalysis();
};
