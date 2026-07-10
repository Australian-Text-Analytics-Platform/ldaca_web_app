import { useMemo, type ReactNode } from 'react';
import { useWorkspaceInternal } from './hooks/useWorkspaceInternal';
import {
  WorkspaceActionsContext,
  WorkspaceDataContext,
  WorkspaceSelectionContext,
  WorkspaceStatusContext,
} from './WorkspaceContext';

/**
 * Renders four nested context providers, one per slice. Each slice value
 * is memoized on its underlying primitives so the providers only push a
 * new value when something in *that* slice actually changed; the action
 * surface (~30 consumers, biggest re-render multiplier) stays referentially
 * stable across data/selection churn.
 *
 * Internally everything still flows through `useWorkspaceInternal` so the
 * sub-hooks (core / queries / mutations) keep their orchestration in one
 * place; the provider's only job is to fan-out into the four contexts.
 * Rendered by `WorkspaceShell` so workspace descendants can subscribe to individual slices.
 * Flow: composed hooks build data, selection, status, and action slices so descendants subscribe only to the workspace state they use.
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
    }),
    [ws.workspaces, ws.currentWorkspace, ws.currentWorkspaceId, ws.nodes, ws.workspaceGraph],
  );

  const selectionValue = useMemo(
    () => ({
      selectedNode: ws.selectedNode,
      selectedNodes: ws.selectedNodes,
      activeNodeId: ws.activeNodeId,
      selectedNodeIds: ws.selectedNodeIds,
    }),
    [ws.selectedNode, ws.selectedNodes, ws.activeNodeId, ws.selectedNodeIds],
  );

  const statusValue = useMemo(
    () => ({
      isLoading: ws.isLoading,
    }),
    [ws.isLoading],
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
