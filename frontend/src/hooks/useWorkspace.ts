import { useMemo } from 'react';
import { useWorkspaceData } from './useWorkspaceData';
import { useWorkspaceSelection } from './useWorkspaceSelection';
import { useWorkspaceActions } from './useWorkspaceActions';
import { useWorkspaceStatus } from './useWorkspaceStatus';

/**
 * Backward-compatible hook that merges workspace slices for consumers
 * still expecting the monolithic useWorkspace return signature.
 */
export const useWorkspace = () => {
  const data = useWorkspaceData();
  const selection = useWorkspaceSelection();
  const actions = useWorkspaceActions();
  const status = useWorkspaceStatus();

  return useMemo(
    () => ({
      ...data,
      ...selection,
      ...status,
      ...actions,
      actions,
    }),
    [actions, data, selection, status],
  );
};
