import { useWorkspaceContext } from '../providers/WorkspaceProvider';

export const useWorkspaceSelection = () => {
  const { selection } = useWorkspaceContext();
  return selection;
};
