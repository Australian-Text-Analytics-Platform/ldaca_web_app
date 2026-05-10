import { useContext } from 'react';
import { WorkspaceStatusContext } from '../WorkspaceContext';

export const useWorkspaceStatus = () => {
  const status = useContext(WorkspaceStatusContext);
  if (!status) {
    throw new Error('useWorkspaceStatus must be used within a WorkspaceProvider');
  }
  return status;
};
