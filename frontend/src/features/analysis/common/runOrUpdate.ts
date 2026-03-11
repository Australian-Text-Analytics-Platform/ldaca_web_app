interface ExecuteAnalysisRunOrUpdateArgs {
  hasLockedParameterChanges: boolean;
  clearResults: () => Promise<void>;
  runFreshAnalysis: () => Promise<void>;
}

export const executeAnalysisRunOrUpdate = async ({
  hasLockedParameterChanges,
  clearResults,
  runFreshAnalysis,
}: ExecuteAnalysisRunOrUpdateArgs): Promise<void> => {
  if (hasLockedParameterChanges) {
    await clearResults();
  }

  await runFreshAnalysis();
};
