import { useContext } from 'react';
import { WorkspaceDataContext } from '../WorkspaceContext';

export const useWorkspaceData = () => {
  const data = useContext(WorkspaceDataContext);
  if (!data) {
    throw new Error('useWorkspaceData must be used within a WorkspaceProvider');
  }
  return data;
};
