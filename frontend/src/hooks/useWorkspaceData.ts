import { useWorkspaceContext } from '../providers/WorkspaceProvider';

export const useWorkspaceData = () => {
  const { data } = useWorkspaceContext();
  return data;
};
