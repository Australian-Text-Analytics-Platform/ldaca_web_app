import { useRef, useState } from 'react';

/**
 * Prevents a "running" result from overwriting an already "successful" one,
 * which can happen when a stale polling response arrives after the terminal result.
 */
export function useSafeResult<T extends { state?: string } | null>() {
  const [result, setResult] = useState<T | null>(null);
  const resultRef = useRef<T | null>(null);

  const setResultSafely = (newResult: T | null) => {
    if (
      resultRef.current?.state === 'successful' &&
      (newResult as { state?: string } | null)?.state === 'running'
    ) {
      return;
    }
    setResult(newResult);
    resultRef.current = newResult;
  };

  return [result, resultRef, setResultSafely, setResult] as const;
}
