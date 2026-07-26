import type { Analysis } from '@/api';

interface AnalysisActionLifecycleInput {
  /** Preview submission or canonical Preview lifecycle is active. */
  isPreviewing: boolean;
  /** Run All request is still crossing the mutation boundary. */
  isSubmittingRunAll: boolean;
  /** Canonical state of the newest Run All root in the Tab forest. */
  runAllState: Analysis['state'] | null;
  /** The Tab forest contains an active non-supporting Analysis. */
  hasActiveAnalysis: boolean;
}

export interface AnalysisActionLifecycle {
  isPreviewing: boolean;
  isRunningAll: boolean;
  parametersLocked: boolean;
  previewDisabled: boolean;
  runAllDisabled: boolean;
}

const isActive = (state: Analysis['state'] | null): boolean =>
  state === 'queued' || state === 'running';

/**
 * Assigns each action's presentation to its own canonical Analysis scope.
 *
 * Preview and Run All are independent roots, but only one action may present
 * the Tab's active lifecycle. Parameters are locked only while Run All is
 * active; a durable Result does not turn the submitted request into UI state.
 */
export const getAnalysisActionLifecycle = ({
  isPreviewing,
  isSubmittingRunAll,
  runAllState,
  hasActiveAnalysis,
}: AnalysisActionLifecycleInput): AnalysisActionLifecycle => {
  const isRunningAll = isSubmittingRunAll || isActive(runAllState);
  const parametersLocked = isRunningAll;
  const effectiveIsPreviewing = isPreviewing && !parametersLocked && runAllState !== 'succeeded';

  return {
    isPreviewing: effectiveIsPreviewing,
    isRunningAll,
    parametersLocked,
    previewDisabled: parametersLocked || hasActiveAnalysis,
    runAllDisabled: effectiveIsPreviewing || isRunningAll || hasActiveAnalysis,
  };
};
