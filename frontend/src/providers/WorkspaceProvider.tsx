import type { ReactNode } from 'react';
import { useWorkspaceInternal } from '../hooks/useWorkspaceInternal';
import { WorkspaceContext } from './WorkspaceContext';

/**
 * Workspace provider.
 *
 * The underlying `useWorkspaceInternal` hook exposes a wide surface; this
 * component groups it into the four `data / selection / status / actions`
 * slices defined in `WorkspaceContext.ts` so consumers only pull what they
 * actually depend on.
 */
export const WorkspaceProvider = ({ children }: { children: ReactNode }) => {
  const ws = useWorkspaceInternal();

  const value = {
    data: {
      workspaces: ws.workspaces,
      currentWorkspace: ws.currentWorkspace,
      currentWorkspaceId: ws.currentWorkspaceId,
      nodes: ws.nodes,
      workspaceGraph: ws.workspaceGraph,
      nodeData: ws.nodeData,
    },
    selection: {
      selectedNode: ws.selectedNode,
      selectedNodes: ws.selectedNodes,
      selectedNodeId: ws.selectedNodeId,
      selectedNodeIds: ws.selectedNodeIds,
      handlePageChange: ws.handlePageChange,
      handlePageSizeChange: ws.handlePageSizeChange,
    },
    status: {
      isLoading: ws.isLoading,
      errors: ws.errors,
    },
    actions: ws.actions,
  };

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
};
