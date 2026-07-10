import { useContext } from 'react';
import { WorkspaceSelectionContext } from '../WorkspaceContext';

/**
 * Reads selected-node state and pagination handlers from WorkspaceProvider.
 * Used by `WorkspaceControls`, `Sidebar`, hint conditions, and feature hooks
 * that need only the current node selection slice.
 * Why: because workspace chrome and sidebar controls need only selection state and setters from the provider.
 */
export const useWorkspaceSelection = () => {
  const selection = useContext(WorkspaceSelectionContext);
  if (!selection) {
    throw new Error('useWorkspaceSelection must be used within a WorkspaceProvider');
  }
  return selection;
};
