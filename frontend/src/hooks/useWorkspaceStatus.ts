import { useWorkspaceContext } from '../providers/WorkspaceProvider';

export const useWorkspaceStatus = () => {
  const { status } = useWorkspaceContext();
  return status;
};
