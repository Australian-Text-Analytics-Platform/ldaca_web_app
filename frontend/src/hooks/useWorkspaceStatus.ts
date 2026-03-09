import { useWorkspaceContext } from '../providers/useWorkspaceContext';

export const useWorkspaceStatus = () => {
  const { status } = useWorkspaceContext();
  return status;
};
