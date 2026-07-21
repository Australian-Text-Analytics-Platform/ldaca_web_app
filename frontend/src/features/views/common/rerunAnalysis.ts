import type { ClearAnalysisUiOptions } from './hooks/useAnalysisFeature';

interface ExecuteAnalysisRerunArgs {
  /** True when the owning Tab currently references a root Analysis. */
  hasAttachedAnalysis: boolean;
  clearResults: (options?: ClearAnalysisUiOptions) => Promise<boolean>;
  runFreshAnalysis: () => Promise<void>;
}

/**
 * Shared branch for the Run/Re-run button.
 *
 * Before a re-run, clear the Tab's attached Analysis so the replacement request
 * can become its single root Analysis; otherwise run directly. A failed clear
 * aborts submission and leaves the existing local state intact.
 */
export const executeAnalysisRerun = async ({
  hasAttachedAnalysis,
  clearResults,
  runFreshAnalysis,
}: ExecuteAnalysisRerunArgs): Promise<void> => {
  if (hasAttachedAnalysis) {
    const cleared = await clearResults({ preserveLocalState: true });
    if (!cleared) return;
  }

  await runFreshAnalysis();
};
