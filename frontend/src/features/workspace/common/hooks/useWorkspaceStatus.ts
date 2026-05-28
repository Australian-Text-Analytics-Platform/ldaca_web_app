import { useContext } from 'react';
import { WorkspaceStatusContext } from '../WorkspaceContext';

/**
 * Reads workspace loading/error state from the sliced WorkspaceProvider context.
 * Used by: ConcordanceFeature module, DataPreprocessingFeature tests, DataPreprocessingFeature module (rg call sites/imports).
 * Why: because analysis and workspace controls need loading/error/operation state without subscribing to data or actions.
 */
export const useWorkspaceStatus = () => {
  const status = useContext(WorkspaceStatusContext);
  if (!status) {
    throw new Error('useWorkspaceStatus must be used within a WorkspaceProvider');
  }
  return status;
};
