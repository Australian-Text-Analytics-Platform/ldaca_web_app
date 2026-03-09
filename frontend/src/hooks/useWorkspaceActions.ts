import { useWorkspaceContext } from '../providers/useWorkspaceContext';

export const useWorkspaceActions = () => {
  const { actions } = useWorkspaceContext();
  return actions;
};
