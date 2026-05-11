import { useContext } from 'react';
import { WorkspaceActionsContext } from '../WorkspaceContext';

export const useWorkspaceActions = () => {
  const actions = useContext(WorkspaceActionsContext);
  if (!actions) {
    throw new Error('useWorkspaceActions must be used within a WorkspaceProvider');
  }
  return actions;
};
