import { useRef, useState, useCallback } from 'react';

/**
 * Prevents a "running" result from overwriting an already "successful" one,
 * which can happen when a stale polling response arrives after the terminal result.
 */
export function useSafeResult<T extends { state?: string } | null>() {
  const [result, setResult] = useState<T | null>(null);
  const resultRef = useRef<T | null>(null);

  const setResultSafely = useCallback((newResult: T | null) => {
    if (
      resultRef.current?.state === 'successful' &&
      (newResult as any)?.state === 'running'
    ) {
      return;
    }
    setResult(newResult);
    resultRef.current = newResult;
  }, []);

  return [result, resultRef, setResultSafely, setResult] as const;
}
