import { createContext } from 'react';
import type { useWorkspaceInternal } from '../hooks/useWorkspaceInternal';

type WorkspaceInternal = ReturnType<typeof useWorkspaceInternal>;

export type WorkspaceDataSlice = {
  workspaces: WorkspaceInternal['workspaces'];
  currentWorkspace: WorkspaceInternal['currentWorkspace'];
  currentWorkspaceId: WorkspaceInternal['currentWorkspaceId'];
  nodes: WorkspaceInternal['nodes'];
  workspaceGraph: WorkspaceInternal['workspaceGraph'];
  nodeData: WorkspaceInternal['nodeData'];
};

export type WorkspaceSelectionSlice = {
  selectedNode: WorkspaceInternal['selectedNode'];
  selectedNodes: WorkspaceInternal['selectedNodes'];
  selectedNodeId: WorkspaceInternal['selectedNodeId'];
  selectedNodeIds: WorkspaceInternal['selectedNodeIds'];
  handlePageChange: WorkspaceInternal['handlePageChange'];
  handlePageSizeChange: WorkspaceInternal['handlePageSizeChange'];
  handleSortingChange: WorkspaceInternal['handleSortingChange'];
  handleFilterChange: WorkspaceInternal['handleFilterChange'];
  getPaginationForNode: WorkspaceInternal['getPaginationForNode'];
};

export type WorkspaceStatusSlice = {
  isLoading: WorkspaceInternal['isLoading'];
  errors: WorkspaceInternal['errors'];
};

export type WorkspaceActionsSlice = WorkspaceInternal['actions'];

export interface WorkspaceContextValue {
  data: WorkspaceDataSlice;
  selection: WorkspaceSelectionSlice;
  actions: WorkspaceActionsSlice;
  status: WorkspaceStatusSlice;
}

export const WorkspaceContext = createContext<WorkspaceContextValue | undefined>(undefined);
