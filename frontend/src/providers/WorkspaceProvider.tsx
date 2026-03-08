import { createContext, type ReactNode, useContext } from 'react';
import { useWorkspaceInternal } from '../hooks/useWorkspaceInternal';

type WorkspaceInternal = ReturnType<typeof useWorkspaceInternal>;

type WorkspaceDataSlice = {
  workspaces: WorkspaceInternal['workspaces'];
  currentWorkspace: WorkspaceInternal['currentWorkspace'];
  currentWorkspaceId: WorkspaceInternal['currentWorkspaceId'];
  nodes: WorkspaceInternal['nodes'];
  workspaceGraph: WorkspaceInternal['workspaceGraph'];
  nodeData: WorkspaceInternal['nodeData'];
};

type WorkspaceSelectionSlice = {
  selectedNode: WorkspaceInternal['selectedNode'];
  selectedNodes: WorkspaceInternal['selectedNodes'];
  selectedNodeId: WorkspaceInternal['selectedNodeId'];
  selectedNodeIds: WorkspaceInternal['selectedNodeIds'];
  handlePageChange: WorkspaceInternal['handlePageChange'];
  handlePageSizeChange: WorkspaceInternal['handlePageSizeChange'];
};

type WorkspaceStatusSlice = {
  isLoading: WorkspaceInternal['isLoading'];
  errors: WorkspaceInternal['errors'];
};

type WorkspaceActionsSlice = WorkspaceInternal['actions'];

interface WorkspaceContextValue {
  data: WorkspaceDataSlice;
  selection: WorkspaceSelectionSlice;
  actions: WorkspaceActionsSlice;
  status: WorkspaceStatusSlice;
}

const WorkspaceContext = createContext<WorkspaceContextValue | undefined>(undefined);

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

export const useWorkspaceContext = () => {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error('useWorkspaceContext must be used within a WorkspaceProvider');
  }
  return context;
};
