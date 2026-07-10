import { extractAndSetTaskId } from '../extractTaskId';

interface CurrentRef<T> {
  current: T;
}

interface AnalysisRunTaskMarker {
  taskId: string | null;
  state: string | null;
}

interface AnalysisRunResponse {
  state?: string | null;
}

interface RunAnalysisTaskEnvelopeOptions<TResponse extends AnalysisRunResponse> {
  lastFetchedRef: CurrentRef<AnalysisRunTaskMarker>;
  runningRef: CurrentRef<boolean>;
  setIsRunning: (value: boolean) => void;
  setLocalTaskId: (taskId: string | null) => void;
  onTaskIdAssigned: (taskId: string | null) => void;
  resetBeforeRun: () => void;
  submit: () => Promise<TResponse>;
  onSuccess: (response: TResponse, taskId: string | null) => void;
  onError: (error: unknown) => void;
  shouldReleaseRunning?: (response: TResponse) => boolean;
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
 * a backend task id in their response metadata.
 *
 * Used by: token-frequency and topic-modeling task-flow hooks because both
 * workflows share the same task marker reset, running-flag ownership, task-id
 * handoff, and failed-run cleanup while keeping their request/result handling
 * feature-specific.
 *
 * Flow: reset the last fetched marker, mark the run active, let the feature
 * clear its local result/error state, submit the API request, store/report the
 * returned task id, then release the running flag only for failed responses or
 * thrown submit errors.
 */
export async function runAnalysisTaskEnvelope<TResponse extends AnalysisRunResponse>({
  lastFetchedRef,
  runningRef,
  setIsRunning,
  setLocalTaskId,
  onTaskIdAssigned,
  resetBeforeRun,
  submit,
  onSuccess,
  onError,
  shouldReleaseRunning = (response) => response.state === 'failed',
}: RunAnalysisTaskEnvelopeOptions<TResponse>): Promise<TResponse | null> {
  lastFetchedRef.current = { taskId: null, state: null };
  setIsRunning(true);
  runningRef.current = true;
  resetBeforeRun();

  try {
    const response = await submit();
    const taskId = extractAndSetTaskId(response, setLocalTaskId);
    onTaskIdAssigned(taskId);
    onSuccess(response, taskId);

    if (shouldReleaseRunning(response)) {
      releaseRunning(runningRef, setIsRunning);
    }

    return response;
  } catch (error) {
    onError(error);
    releaseRunning(runningRef, setIsRunning);
    return null;
  }
}
