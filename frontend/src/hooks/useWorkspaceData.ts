import { useWorkspaceContext } from '../providers/useWorkspaceContext';

export const useWorkspaceData = () => {
  const { data } = useWorkspaceContext();
  return data;
};
