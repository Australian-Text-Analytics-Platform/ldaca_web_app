import { useRef, useState } from 'react';

type ResultLike = { state?: string | null };

/**
 * Orders backend task states by freshness so polling consumers can ignore older
 * in-flight snapshots once a terminal result has reached the UI.
 */
const RESULT_STATE_RANK: Record<string, number> = {
  pending: 0,
  running: 1,
  failed: 2,
  cancelled: 2,
  successful: 2,
  completed: 2,
};

/** Terminal result states that should not be overwritten by another terminal response. */
const TERMINAL_STATES = new Set(['failed', 'cancelled', 'successful', 'completed']);

/**
 * Normalizes missing or unfamiliar states to the earliest rank expected by the
 * stale-result guard used across analysis polling hooks.
 * Called by: isStaleAnalysisResult when comparing current and incoming task states because the caller needs this analysis-specific step before continuing its request, result, display, or cleanup workflow.
 */
function resultStateRank(state: string | null | undefined): number {
  return state ? (RESULT_STATE_RANK[state] ?? 0) : 0;
}

/**
 * Detects task responses that would move the UI backward, mainly when a slower
 * poll resolves after a newer terminal response has already been rendered.
 * Used by: useSafeResult and stale-result regression tests because polling should not replace terminal task outcomes with older in-flight responses.
 */
export function isStaleAnalysisResult<
  Current extends ResultLike,
  Next extends ResultLike,
>(current: Current | null, next: Next | null): boolean {
  if (!current || !next) {
    return false;
  }

  const currentState = current.state;
  const nextState = next.state;
  const currentRank = resultStateRank(currentState);
  const nextRank = resultStateRank(nextState);

  if (nextRank < currentRank) {
    return true;
  }

  return Boolean(
    currentState &&
      nextState &&
      currentState !== nextState &&
      TERMINAL_STATES.has(currentState) &&
      TERMINAL_STATES.has(nextState),
  );
}

/**
 * Wraps result state for analysis hooks that poll tasks, giving them a setter
 * that protects terminal outcomes from late stale responses.
 * Used by: analysis feature screens that keep live task results in React state because callers need shared hook state and handlers without duplicating analysis lifecycle wiring.
 */
export function useSafeResult<T extends ResultLike | null>() {
  const [result, setResult] = useState<T | null>(null);
  const resultRef = useRef<T | null>(null);

  /** Called by: analysis task-flow callbacks through the setter returned from useSafeResult because the caller needs this analysis-specific step before continuing its request, result, display, or cleanup workflow. */
  const setResultSafely = (newResult: T | null) => {
    if (isStaleAnalysisResult(resultRef.current, newResult)) {
      return;
    }
    setResult(newResult);
    resultRef.current = newResult;
  };

  return [result, resultRef, setResultSafely, setResult] as const;
}
