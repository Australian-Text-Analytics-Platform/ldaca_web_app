import { useEffect, useRef } from 'react';
import type { TopicClustering, TopicInclusion, TopicModelingProjectionSelection } from '@/api';

export interface TopicProjectionAttempt {
  analysisId: string;
  clusterCount: number;
  topNTopics: number;
  requestKey: number;
  layoutChanged: boolean;
}

export function nextTopicProjectionAttempt(
  current: TopicProjectionAttempt | null,
  analysisId: string | null,
  clusterCount: number,
  topNTopics: number,
  appliedClusterCount: number | null,
  appliedTopNTopics: number | null,
): TopicProjectionAttempt | null {
  if (!analysisId) return current;
  if (
    current?.analysisId === analysisId &&
    current.clusterCount === clusterCount &&
    current.topNTopics === topNTopics
  ) {
    return current;
  }
  if (clusterCount === appliedClusterCount && topNTopics === appliedTopNTopics) return current;
  return {
    analysisId,
    clusterCount,
    topNTopics,
    requestKey: (current?.requestKey ?? 0) + 1,
    layoutChanged: clusterCount !== appliedClusterCount,
  };
}

interface UseTopicProjectionLifecycleOptions {
  analysisId: string | null;
  attempt: TopicProjectionAttempt | null;
  clustering: TopicClustering | null;
  topicInclusion: TopicInclusion | null;
  isFetching: boolean;
  isPlaceholderData: boolean;
  isViewReady: boolean;
  resultError: string | null;
  onProjectionApplied: (layoutChanged: boolean) => void;
  persistSelection: (selection: TopicModelingProjectionSelection | null) => Promise<unknown>;
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
  topicInclusion,
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
    currentAttempt &&
      clustering?.cluster_count === currentAttempt.clusterCount &&
      topicInclusion?.top_n_topics === currentAttempt.topNTopics,
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
    if (!currentAttempt || !clustering || !topicInclusion || !resolvedAttempt) return;
    const attemptId = `${currentAttempt.analysisId}:${String(currentAttempt.requestKey)}`;
    if (handledAttemptRef.current === attemptId) return;
    handledAttemptRef.current = attemptId;

    callbacksRef.current.onProjectionApplied(currentAttempt.layoutChanged);
    const selection =
      currentAttempt.clusterCount === clustering.default_cluster_count &&
      currentAttempt.topNTopics === topicInclusion.default_top_n_topics
        ? null
        : {
            analysis_id: currentAttempt.analysisId,
            cluster_count: currentAttempt.clusterCount,
            top_n_topics: currentAttempt.topNTopics,
          };
    void callbacksRef.current.persistSelection(selection).catch((cause: unknown) => {
      callbacksRef.current.onPersistenceError?.(cause);
    });
  }, [clustering, currentAttempt, resolvedAttempt, topicInclusion]);

  return {
    projectionPending,
    projectionError,
    controlResetKey: projectionError ? (currentAttempt?.requestKey ?? 0) : 0,
  };
}
