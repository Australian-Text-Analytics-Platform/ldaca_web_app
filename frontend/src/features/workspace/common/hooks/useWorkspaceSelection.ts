import { useWorkspaceContext } from '../useWorkspaceContext';

export const useWorkspaceSelection = () => {
  const { selection } = useWorkspaceContext();
  return selection;
};
