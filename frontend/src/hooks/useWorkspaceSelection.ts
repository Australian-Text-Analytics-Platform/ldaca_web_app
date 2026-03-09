import { useWorkspaceContext } from '../providers/useWorkspaceContext';

export const useWorkspaceSelection = () => {
  const { selection } = useWorkspaceContext();
  return selection;
};
