import { useWorkspaceContext } from '../useWorkspaceContext';

export const useWorkspaceStatus = () => {
  const { status } = useWorkspaceContext();
  return status;
};
