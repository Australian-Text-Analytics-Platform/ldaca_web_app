import { useEffect } from 'react';
import {
  useAnalysisServerRequestLock,
  type ServerLockAnalysisType,
} from './useAnalysisServerRequestLock';
import { useAnalysisLockMachine, type AnalysisLockConfig } from '../useAnalysisLockMachine';

export interface UseAnalysisLockConfig extends AnalysisLockConfig {
  analysisType: ServerLockAnalysisType;
  workspaceId: string | null;
  getAuthHeaders: () => Record<string, string>;
  // Active analysis tab's persisted task id. Every analysis feature is
  // tab-mounted, so the lock reflects THIS tab's task: a tab is locked exactly
  // when it owns a ``taskId``. A fresh tab that has not run yet passes null and
  // stays unlocked so its node-selection panel syncs with the live graph.
  taskId: string | null;
}

/**
 * Composes server lock query + local lock machine + lock-state wiring into a
 * single hook. Replaces the per-feature pattern of calling
 * useAnalysisServerRequestLock, useAnalysisLockMachine, and a useEffect to wire
 * them together.
 * Used by: analysis feature screens that need result locking.
 *
 * Lock model: a tab is locked exactly when it owns a ``taskId``. The lock flag
 * is derived purely from that id; the locked node snapshot itself is installed
 * by task hydration or a fresh run. A tab with no task stays unlocked so its
 * node-selection panel syncs with the live workspace graph selection. The
 * server request is still fetched (for parameter-diff display) but no longer
 * decides lock state.
 * Flow: query the server lock, construct the local lock machine, drive
 * ``isLocked`` from the tab's task id, then expose the merged contract.
 */
export function useAnalysisLock(config: UseAnalysisLockConfig) {
  const { analysisType, workspaceId, getAuthHeaders, taskId, ...lockConfig } = config;

  const serverLock = useAnalysisServerRequestLock({
    analysisType,
    workspaceId,
    getAuthHeaders,
    taskId,
  });

  const lockState = useAnalysisLockMachine({
    ...lockConfig,
    workspaceId,
    getAuthHeaders,
  });

  useEffect(() => {
    // Lock iff this tab owns a task id. Only act on transitions so we never
    // fight hydration/run (which install the locked snapshot). Unlocking routes
    // through unlockSelection, which hands the previously-locked nodes back to
    // the graph selection (locked→unlocked conflict handling).
    if (taskId == null) {
      if (lockState.isLocked) lockState.unlockSelection();
    } else if (!lockState.isLocked) {
      lockState.setIsLocked(true);
    }
  }, [taskId, lockState]);

  return {
    ...lockState,
    hasServerRequest: serverLock.hasServerRequest,
    currentTaskId: serverLock.currentTaskId,
    serverRequest: serverLock.serverRequest,
    serverLockIsLoading: serverLock.isLoading,
    serverLockIsFetching: serverLock.isFetching,
    refetchServerLock: serverLock.refetch,
  };
}
