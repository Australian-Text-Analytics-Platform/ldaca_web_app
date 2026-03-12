import type { ClearAnalysisUiOptions } from './hooks/useAnalysisFeature';

interface ExecuteAnalysisRunOrUpdateArgs {
  hasLockedParameterChanges: boolean;
  clearResults: (options?: ClearAnalysisUiOptions) => Promise<void>;
  runFreshAnalysis: () => Promise<void>;
  clearOptionsOnUpdate?: ClearAnalysisUiOptions;
}

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
