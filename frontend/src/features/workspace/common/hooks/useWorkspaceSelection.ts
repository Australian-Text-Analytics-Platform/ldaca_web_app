import { useContext } from 'react';
import { WorkspaceSelectionContext } from '../WorkspaceContext';

export const useWorkspaceSelection = () => {
  const selection = useContext(WorkspaceSelectionContext);
  if (!selection) {
    throw new Error('useWorkspaceSelection must be used within a WorkspaceProvider');
  }
  return selection;
};
