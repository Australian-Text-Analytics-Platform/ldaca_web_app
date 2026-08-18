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
  /** The Tab forest contains a failed or cancelled non-supporting Analysis. */
  requiresClear?: boolean;
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
 * the Tab's active lifecycle. Parameters lock across the local submission
 * boundary and remain locked while any root Analysis is active. A durable
 * Result does not turn the submitted request back into editable UI state.
 */
export const getAnalysisActionLifecycle = ({
  isPreviewing,
  isSubmittingRunAll,
  runAllState,
  hasActiveAnalysis,
  requiresClear = false,
}: AnalysisActionLifecycleInput): AnalysisActionLifecycle => {
  const isRunningAll = isSubmittingRunAll || isActive(runAllState);
  const effectiveIsPreviewing = isPreviewing && !isRunningAll;
  const parametersLocked = effectiveIsPreviewing || isRunningAll || hasActiveAnalysis;

  return {
    isPreviewing: effectiveIsPreviewing,
    isRunningAll,
    parametersLocked,
    previewDisabled: parametersLocked || requiresClear,
    runAllDisabled: parametersLocked || requiresClear,
  };
};

/** True when the Tab must be cleared before another execution may be submitted. */
export const hasClearRequiredAnalysis = (analyses: Analysis[]): boolean =>
  analyses.some(
    (analysis) =>
      analysis.execution_scope !== 'supporting' &&
      (analysis.state === 'failed' || analysis.state === 'cancelled'),
  );
