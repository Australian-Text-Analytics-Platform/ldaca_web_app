import type { ReactNode } from 'react';
import { useWorkspaceInternal } from '../hooks/useWorkspaceInternal';
import { WorkspaceContext } from './WorkspaceContext';

interface WorkspaceProviderProps {
  children: ReactNode;
}

export const WorkspaceProvider = ({ children }: WorkspaceProviderProps) => {
  const workspace = useWorkspaceInternal();

  const data = ({
    workspaces: workspace.workspaces,
    currentWorkspace: workspace.currentWorkspace,
    currentWorkspaceId: workspace.currentWorkspaceId,
    nodes: workspace.nodes,
    workspaceGraph: workspace.workspaceGraph,
    nodeData: workspace.nodeData,
  });

  const selection = ({
    selectedNode: workspace.selectedNode,
    selectedNodes: workspace.selectedNodes,
    selectedNodeId: workspace.selectedNodeId,
    selectedNodeIds: workspace.selectedNodeIds,
    handlePageChange: workspace.handlePageChange,
    handlePageSizeChange: workspace.handlePageSizeChange,
  });

  const status = ({
    isLoading: workspace.isLoading,
    errors: workspace.errors,
  });

  const actions = workspace.actions;

  const value = ({
    data,
    selection,
    actions,
    status,
  });

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
};
