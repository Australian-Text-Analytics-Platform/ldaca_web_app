import { createContext, ReactNode, useContext, useMemo } from 'react';
import { useWorkspaceInternal } from '../hooks/useWorkspaceInternal';

type WorkspaceInternal = ReturnType<typeof useWorkspaceInternal>;

type WorkspaceDataSlice = {
  workspaces: WorkspaceInternal['workspaces'];
  currentWorkspace: WorkspaceInternal['currentWorkspace'];
  currentWorkspaceId: WorkspaceInternal['currentWorkspaceId'];
  nodes: WorkspaceInternal['nodes'];
  workspaceGraph: WorkspaceInternal['workspaceGraph'];
  nodeData: WorkspaceInternal['nodeData'];
  getNodeShape: WorkspaceInternal['getNodeShape'];
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

  const data = useMemo<WorkspaceDataSlice>(() => ({
    workspaces: workspace.workspaces,
    currentWorkspace: workspace.currentWorkspace,
    currentWorkspaceId: workspace.currentWorkspaceId,
    nodes: workspace.nodes,
    workspaceGraph: workspace.workspaceGraph,
    nodeData: workspace.nodeData,
    getNodeShape: workspace.getNodeShape,
  }), [
    workspace.currentWorkspace,
    workspace.currentWorkspaceId,
    workspace.getNodeShape,
    workspace.nodeData,
    workspace.nodes,
    workspace.workspaces,
    workspace.workspaceGraph,
  ]);

  const selection = useMemo<WorkspaceSelectionSlice>(() => ({
    selectedNode: workspace.selectedNode,
    selectedNodes: workspace.selectedNodes,
    selectedNodeId: workspace.selectedNodeId,
    selectedNodeIds: workspace.selectedNodeIds,
    handlePageChange: workspace.handlePageChange,
    handlePageSizeChange: workspace.handlePageSizeChange,
  }), [
    workspace.handlePageChange,
    workspace.handlePageSizeChange,
    workspace.selectedNode,
    workspace.selectedNodeId,
    workspace.selectedNodeIds,
    workspace.selectedNodes,
  ]);

  const status = useMemo<WorkspaceStatusSlice>(() => ({
    isLoading: workspace.isLoading,
    errors: workspace.errors,
  }), [workspace.errors, workspace.isLoading]);

  const actions = useMemo<WorkspaceActionsSlice>(() => workspace.actions, [workspace.actions]);

  const value = useMemo<WorkspaceContextValue>(() => ({
    data,
    selection,
    actions,
    status,
  }), [actions, data, selection, status]);

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
