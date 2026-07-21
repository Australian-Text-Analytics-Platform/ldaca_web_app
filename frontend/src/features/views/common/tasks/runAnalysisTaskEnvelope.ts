import type { Analysis } from '@/api';
import { extractAndSetTaskId } from '../extractTaskId';

interface CurrentRef<T> {
  current: T;
}

interface AnalysisRunTaskMarker {
  taskId: string | null;
  state: string | null;
}

interface RunAnalysisTaskEnvelopeOptions<TAnalysis extends Analysis> {
  lastFetchedRef: CurrentRef<AnalysisRunTaskMarker>;
  runningRef: CurrentRef<boolean>;
  setIsRunning: (value: boolean) => void;
  setLocalTaskId: (taskId: string | null) => void;
  onTaskIdAssigned: (taskId: string | null) => void;
  resetBeforeRun: () => void;
  submit: () => Promise<TAnalysis>;
  onSuccess: (analysis: TAnalysis, taskId: string | null) => void;
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
 * share task marker reset, running-flag ownership, task-id handoff, and
 * failed-run cleanup while keeping request and Result handling feature-specific.
 *
 * Flow: reset the last fetched marker, mark the run active, let the feature
 * clear its local result/error state, submit the API request, store/report the
 * returned Analysis id, then release the running flag only for rejected
 * terminal responses or thrown submit errors. Results are fetched separately
 * from the Analysis result endpoint after completion.
 *
 * This interface intentionally accepts only the generated Analysis lifecycle
 * resource. Immediate-result workflows store their result directly. A hybrid
 * endpoint must discriminate its response before routing only its background
 * branch through this envelope.
 */
export async function runAnalysisTaskEnvelope<TAnalysis extends Analysis>({
  lastFetchedRef,
  runningRef,
  setIsRunning,
  setLocalTaskId,
  onTaskIdAssigned,
  resetBeforeRun,
  submit,
  onSuccess,
  onError,
}: RunAnalysisTaskEnvelopeOptions<TAnalysis>): Promise<TAnalysis | null> {
  lastFetchedRef.current = { taskId: null, state: null };
  setIsRunning(true);
  runningRef.current = true;
  resetBeforeRun();

  try {
    const response = await submit();
    const taskId = extractAndSetTaskId(response, setLocalTaskId);
    onTaskIdAssigned(taskId);
    onSuccess(response, taskId);

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
