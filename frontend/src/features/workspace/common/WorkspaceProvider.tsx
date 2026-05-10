import { useMemo, type ReactNode } from 'react';
import { useWorkspaceInternal } from './hooks/useWorkspaceInternal';
import {
  WorkspaceActionsContext,
  WorkspaceDataContext,
  WorkspaceSelectionContext,
  WorkspaceStatusContext,
} from './WorkspaceContext';

/**
 * Workspace provider — Phase 4.2 split.
 *
 * Renders four nested context providers, one per slice. Each slice value
 * is memoized on its underlying primitives so the providers only push a
 * new value when something in *that* slice actually changed; the action
 * surface (~30 consumers, biggest re-render multiplier) stays referentially
 * stable across data/selection churn.
 *
 * Internally everything still flows through `useWorkspaceInternal` so the
 * sub-hooks (core / queries / mutations) keep their orchestration in one
 * place; the provider's only job is to fan-out into the four contexts.
 */
export const WorkspaceProvider = ({ children }: { children: ReactNode }) => {
  const ws = useWorkspaceInternal();

  const dataValue = useMemo(
    () => ({
      workspaces: ws.workspaces,
      currentWorkspace: ws.currentWorkspace,
      currentWorkspaceId: ws.currentWorkspaceId,
      nodes: ws.nodes,
      workspaceGraph: ws.workspaceGraph,
      nodeData: ws.nodeData,
    }),
    [
      ws.workspaces,
      ws.currentWorkspace,
      ws.currentWorkspaceId,
      ws.nodes,
      ws.workspaceGraph,
      ws.nodeData,
    ],
  );

  const selectionValue = useMemo(
    () => ({
      selectedNode: ws.selectedNode,
      selectedNodes: ws.selectedNodes,
      selectedNodeId: ws.selectedNodeId,
      selectedNodeIds: ws.selectedNodeIds,
      handlePageChange: ws.handlePageChange,
      handlePageSizeChange: ws.handlePageSizeChange,
      handleSortingChange: ws.handleSortingChange,
      handleFilterChange: ws.handleFilterChange,
      getPaginationForNode: ws.getPaginationForNode,
    }),
    [
      ws.selectedNode,
      ws.selectedNodes,
      ws.selectedNodeId,
      ws.selectedNodeIds,
      ws.handlePageChange,
      ws.handlePageSizeChange,
      ws.handleSortingChange,
      ws.handleFilterChange,
      ws.getPaginationForNode,
    ],
  );

  const statusValue = useMemo(
    () => ({
      isLoading: ws.isLoading,
      errors: ws.errors,
    }),
    [ws.isLoading, ws.errors],
  );

  return (
    <WorkspaceActionsContext.Provider value={ws.actions}>
      <WorkspaceDataContext.Provider value={dataValue}>
        <WorkspaceSelectionContext.Provider value={selectionValue}>
          <WorkspaceStatusContext.Provider value={statusValue}>
            {children}
          </WorkspaceStatusContext.Provider>
        </WorkspaceSelectionContext.Provider>
      </WorkspaceDataContext.Provider>
    </WorkspaceActionsContext.Provider>
  );
};
