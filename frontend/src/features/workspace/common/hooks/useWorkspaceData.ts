import { useContext } from 'react';
import { WorkspaceDataContext } from '../WorkspaceContext';

/**
 * Reads workspace graph/data state from the data slice context.
 * Used by: DataFolderDialog tests, DataFolderDialog component, useWorkspaceDataTable hook (rg call sites/imports).
 * Why: because data-view consumers need only the workspace data context slice without subscribing to actions or status.
 */
export const useWorkspaceData = () => {
  const data = useContext(WorkspaceDataContext);
  if (!data) {
    throw new Error('useWorkspaceData must be used within a WorkspaceProvider');
  }
  return data;
};
