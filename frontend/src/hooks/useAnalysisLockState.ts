import { useMemo } from 'react';
import type { AnalysisLockConfig } from '@/features/analysis/common/useAnalysisLockMachine';
import { useAnalysisLockCore } from '@/features/analysis/common/useAnalysisLockMachine';

export type { AnalysisLockConfig, LockedNodesSnapshot, AnalysisLockState } from '@/features/analysis/common/useAnalysisLockMachine';

export function useAnalysisLockState(config: AnalysisLockConfig) {
  return useAnalysisLockCore(config);
}

/**
 * Hook for managing parameter change detection in locked analysis tabs.
 * 
 * Tracks when analysis parameters have changed since locking, enabling
 * an "Update Results" button to re-run analysis with new parameters.
 * 
 * @param isLocked - Whether the analysis is currently locked
 * @param currentParams - Current parameter values
 * @param lockedParams - Snapshot of parameters when locked (or null)
 * @param compareFn - Optional custom comparison function
 * @returns Whether parameters have changed since locking
 */
export function useParameterChangeDetection<T extends Record<string, unknown>>(
  isLocked: boolean,
  currentParams: T,
  lockedParams: T | null,
  compareFn?: (current: T, locked: T) => boolean
): boolean {
  return useMemo(() => {
    if (!isLocked || !lockedParams) return false;

    if (compareFn) {
      return compareFn(currentParams, lockedParams);
    }

    // Default shallow comparison
    const currentKeys = Object.keys(currentParams);
    const lockedKeys = Object.keys(lockedParams);

    if (currentKeys.length !== lockedKeys.length) return true;

    return currentKeys.some((key) => {
      const current = currentParams[key];
      const locked = lockedParams[key];

      // Handle arrays
      if (Array.isArray(current) && Array.isArray(locked)) {
        if (current.length !== locked.length) return true;
        return current.some((val, idx) => val !== locked[idx]);
      }

      // Handle primitives
      return current !== locked;
    });
  }, [isLocked, currentParams, lockedParams, compareFn]);
}
