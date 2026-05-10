import { useWorkspaceContext } from '../useWorkspaceContext';

export const useWorkspaceActions = () => {
  const { actions } = useWorkspaceContext();
  return actions;
};
