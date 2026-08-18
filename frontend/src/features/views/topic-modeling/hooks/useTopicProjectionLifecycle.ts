import { useEffect, useRef } from 'react';
import type { TopicClustering, TopicModelingClusterSelection } from '@/api';

export interface TopicProjectionAttempt {
  analysisId: string;
  clusterCount: number;
  requestKey: number;
}

export function nextTopicProjectionAttempt(
  current: TopicProjectionAttempt | null,
  analysisId: string | null,
  clusterCount: number,
  appliedClusterCount: number | null,
): TopicProjectionAttempt | null {
  if (!analysisId || clusterCount === appliedClusterCount) return current;
  return {
    analysisId,
    clusterCount,
    requestKey: (current?.requestKey ?? 0) + 1,
  };
}

interface UseTopicProjectionLifecycleOptions {
  analysisId: string | null;
  attempt: TopicProjectionAttempt | null;
  clustering: TopicClustering | null;
  isFetching: boolean;
  isPlaceholderData: boolean;
  isViewReady: boolean;
  resultError: string | null;
  onProjectionApplied: () => void;
  persistSelection: (selection: TopicModelingClusterSelection | null) => Promise<unknown>;
  onPersistenceError?: (cause: unknown) => void;
}

/**
 * Owns one user-committed Topic projection from request identity through
 * atomic Result installation and one post-success presentation write.
 */
export function useTopicProjectionLifecycle({
  analysisId,
  attempt,
  clustering,
  isFetching,
  isPlaceholderData,
  isViewReady,
  resultError,
  onProjectionApplied,
  persistSelection,
  onPersistenceError,
}: UseTopicProjectionLifecycleOptions) {
  const handledAttemptRef = useRef<string | null>(null);
  const callbacksRef = useRef({ onProjectionApplied, persistSelection, onPersistenceError });
  useEffect(() => {
    callbacksRef.current = { onProjectionApplied, persistSelection, onPersistenceError };
  }, [onPersistenceError, onProjectionApplied, persistSelection]);

  const currentAttempt = attempt?.analysisId === analysisId ? attempt : null;
  const attemptMatchesResult = Boolean(
    currentAttempt && clustering?.cluster_count === currentAttempt.clusterCount,
  );
  const projectionError = currentAttempt && resultError ? resultError : null;
  const projectionPending = Boolean(
    currentAttempt &&
      !projectionError &&
      (isFetching || isPlaceholderData || !attemptMatchesResult || !isViewReady),
  );
  const resolvedAttempt = Boolean(
    currentAttempt &&
      !resultError &&
      !isFetching &&
      !isPlaceholderData &&
      attemptMatchesResult &&
      isViewReady,
  );

  useEffect(() => {
    if (!currentAttempt || !clustering || !resolvedAttempt) return;
    const attemptId = `${currentAttempt.analysisId}:${String(currentAttempt.requestKey)}`;
    if (handledAttemptRef.current === attemptId) return;
    handledAttemptRef.current = attemptId;

    callbacksRef.current.onProjectionApplied();
    const selection =
      currentAttempt.clusterCount === clustering.default_cluster_count
        ? null
        : {
            analysis_id: currentAttempt.analysisId,
            cluster_count: currentAttempt.clusterCount,
          };
    void callbacksRef.current.persistSelection(selection).catch((cause: unknown) => {
      callbacksRef.current.onPersistenceError?.(cause);
    });
  }, [clustering, currentAttempt, resolvedAttempt]);

  return {
    projectionPending,
    projectionError,
    sliderResetKey: projectionError ? (currentAttempt?.requestKey ?? 0) : 0,
  };
}
