import { createContext } from 'react';
import type { useWorkspaceInternal } from './hooks/useWorkspaceInternal';

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

/**
 * Each slice gets its own context so consumers re-render only when *their*
 * slice changes. The `actions` slice is the highest-leverage
 * split — it has the most consumers (~30) and rarely changes, so isolating
 * it from `data`/`selection` churn cuts a lot of unnecessary work.
 *
 * Consumers should always go through `useWorkspaceData` /
 * `useWorkspaceSelection` / `useWorkspaceStatus` / `useWorkspaceActions`
 * rather than reading these contexts directly — the wrappers add the
 * "must-be-inside-WorkspaceProvider" runtime check.
 */
export const WorkspaceDataContext = createContext<WorkspaceDataSlice | undefined>(undefined);
export const WorkspaceSelectionContext = createContext<WorkspaceSelectionSlice | undefined>(undefined);
export const WorkspaceStatusContext = createContext<WorkspaceStatusSlice | undefined>(undefined);
export const WorkspaceActionsContext = createContext<WorkspaceActionsSlice | undefined>(undefined);
