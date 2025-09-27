import { useWorkspaceContext } from '../providers/WorkspaceProvider';

export const useWorkspaceActions = () => {
  const { actions } = useWorkspaceContext();
  return actions;
};
