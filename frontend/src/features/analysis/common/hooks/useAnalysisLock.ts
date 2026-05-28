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
}

/**
 * Composes server lock query + local lock machine + hasServerRequest→setIsLocked wiring
 * into a single hook. Replaces the per-feature pattern of calling useAnalysisServerRequestLock,
 * useAnalysisLockState/useAnalysisLockMachine, and a useEffect to wire them together.
 * Used by: analysis feature screens that need server-aware result locks because task hydration and local UI locks must stay synchronized across refreshes.
 * Flow: query the server lock, construct the local lock machine, mirror server presence into local lock state, then expose the merged lock contract.
 */
export function useAnalysisLock(config: UseAnalysisLockConfig) {
  const { analysisType, workspaceId, getAuthHeaders, ...lockConfig } = config;

  const serverLock = useAnalysisServerRequestLock({
    analysisType,
    workspaceId,
    getAuthHeaders,
  });

  const lockState = useAnalysisLockMachine({
    ...lockConfig,
    workspaceId,
    getAuthHeaders,
  });

  useEffect(() => {
    lockState.setIsLocked(serverLock.hasServerRequest);
  }, [serverLock.hasServerRequest, lockState]);

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
