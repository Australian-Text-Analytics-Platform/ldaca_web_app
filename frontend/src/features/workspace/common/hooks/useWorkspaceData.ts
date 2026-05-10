import { useWorkspaceContext } from '../useWorkspaceContext';

export const useWorkspaceData = () => {
  const { data } = useWorkspaceContext();
  return data;
};
