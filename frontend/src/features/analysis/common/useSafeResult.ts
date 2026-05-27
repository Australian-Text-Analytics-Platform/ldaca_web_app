import { useRef, useState } from 'react';

type ResultLike = { state?: string | null };

const RESULT_STATE_RANK: Record<string, number> = {
  pending: 0,
  running: 1,
  failed: 2,
  cancelled: 2,
  successful: 2,
  completed: 2,
};

const TERMINAL_STATES = new Set(['failed', 'cancelled', 'successful', 'completed']);

function resultStateRank(state: string | null | undefined): number {
  return state ? (RESULT_STATE_RANK[state] ?? 0) : 0;
}

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
 * Prevents stale polling results from overwriting newer terminal results.
 */
export function useSafeResult<T extends ResultLike | null>() {
  const [result, setResult] = useState<T | null>(null);
  const resultRef = useRef<T | null>(null);

  const setResultSafely = (newResult: T | null) => {
    if (isStaleAnalysisResult(resultRef.current, newResult)) {
      return;
    }
    setResult(newResult);
    resultRef.current = newResult;
  };

  return [result, resultRef, setResultSafely, setResult] as const;
}
