import { useContext } from 'react';
import { WorkspaceActionsContext } from '../WorkspaceContext';

/**
 * Reads workspace mutation and selection actions from WorkspaceProvider.
 * Used by: DataFolderDialog component, DataFolderDialog tests, WorkspaceControls component (rg call sites/imports).
 * Why: because feature controls need the mutation action context slice without importing provider internals.
 */
export const useWorkspaceActions = () => {
  const actions = useContext(WorkspaceActionsContext);
  if (!actions) {
    throw new Error('useWorkspaceActions must be used within a WorkspaceProvider');
  }
  return actions;
};
