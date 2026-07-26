import type { Analysis } from '@/api';

interface CurrentRef<T> {
  current: T;
}

interface RunAnalysisTaskEnvelopeOptions<TAnalysis extends Analysis> {
  runningRef: CurrentRef<boolean>;
  setIsRunning: (value: boolean) => void;
  setLocalTaskId: (taskId: string | null) => void;
  onSubmitted: () => void;
  resetBeforeRun?: () => void;
  submit: () => Promise<TAnalysis>;
  onSuccess?: (analysis: TAnalysis) => void;
  onError: (error: unknown) => void;
}

const releaseRunning = (
  runningRef: CurrentRef<boolean>,
  setIsRunning: (value: boolean) => void,
) => {
  setIsRunning(false);
  runningRef.current = false;
};

/**
 * Runs the common frontend submit envelope for async analysis tasks that return
 * a canonical Analysis resource.
 *
 * Used by: every tab-owned background-analysis submit flow. The workflows
 * share running-flag ownership, transient task-id handoff, forest refresh, and
 * failed-run cleanup while keeping request and Result handling feature-specific.
 *
 * Flow: mark the run active, let the feature clear local result/error state,
 * submit the API request, store its transient Analysis id, refresh the canonical
 * Tab forest, then release the running flag only for rejected terminal responses
 * or thrown submit errors. Results are fetched separately from the Analysis
 * result endpoint after completion.
 *
 * This interface intentionally accepts only the generated Analysis lifecycle
 * resource. Immediate-result workflows store their result directly. A hybrid
 * endpoint must discriminate its response before routing only its background
 * branch through this envelope.
 */
export async function runAnalysisTaskEnvelope<TAnalysis extends Analysis>({
  runningRef,
  setIsRunning,
  setLocalTaskId,
  onSubmitted,
  resetBeforeRun,
  submit,
  onSuccess,
  onError,
}: RunAnalysisTaskEnvelopeOptions<TAnalysis>): Promise<TAnalysis | null> {
  setIsRunning(true);
  runningRef.current = true;
  resetBeforeRun?.();

  try {
    const response = await submit();
    const taskId = response.id;
    setLocalTaskId(taskId);
    onSubmitted();
    onSuccess?.(response);

    if (response.state === 'failed' || response.state === 'cancelled') {
      releaseRunning(runningRef, setIsRunning);
    }

    return response;
  } catch (error) {
    onError(error);
    releaseRunning(runningRef, setIsRunning);
    return null;
  }
}
