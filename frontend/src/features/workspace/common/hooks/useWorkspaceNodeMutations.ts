import { useMemo } from 'react';
import { type QueryClient } from '@tanstack/react-query';
import { refreshWorkspaceNodeSchema } from './workspaceSchemaRefresh';
import { useWorkspaceAnalysisMutations } from './useWorkspaceAnalysisMutations';
import { useWorkspaceGraphMutations } from './useWorkspaceGraphMutations';
import { useWorkspaceManagementMutations } from './useWorkspaceManagementMutations';
import { useWorkspaceTransformMutations } from './useWorkspaceTransformMutations';

interface WorkspaceNodeMutationsParams {
  authHeaders: Record<string, string>;
  currentWorkspaceId: string | null;
  selectedNodeId: string | null;
  setCurrentWorkspaceId: (workspaceId: string | null) => void;
  setSelectedNodes: (nodeIds: string[]) => void;
  clearSelection: () => void;
  queryClient: QueryClient;
  startOperation: (operationId: string) => void;
  endOperation: (operationId: string) => void;
  setOperationError: (operationId: string, error: string) => void;
}

/**
 * Builds the workspace action surface from generated API mutations. The
 * provider exposes these methods to data-loader, graph, data-view, and analysis
 * features.
 * Used by: WorkspaceProvider module, useWorkspaceInternal hook, useWorkspaceInternal tests (rg call sites/imports) because workspace contexts need one generated-API mutation facade.
 * Flow: provider injects auth and selection state, actions call generated SDK mutations, then lifecycle handlers update operation state, selection, and caches.
 */
export const useWorkspaceNodeMutations = ({
  authHeaders,
  currentWorkspaceId,
  selectedNodeId,
  setCurrentWorkspaceId,
  setSelectedNodes,
  clearSelection,
  queryClient,
  startOperation,
  endOperation,
  setOperationError,
}: WorkspaceNodeMutationsParams) => {
  const { actions: managementActions } = useWorkspaceManagementMutations({
    authHeaders,
    currentWorkspaceId,
    setCurrentWorkspaceId,
    clearSelection,
    queryClient,
    startOperation,
    endOperation,
    setOperationError,
  });

  const { actions: graphActions } = useWorkspaceGraphMutations({
    authHeaders,
    currentWorkspaceId,
    selectedNodeId,
    setSelectedNodes,
    clearSelection,
    queryClient,
    startOperation,
    endOperation,
    setOperationError,
  });

  const { actions: transformActions } = useWorkspaceTransformMutations({
    authHeaders,
    currentWorkspaceId,
    queryClient,
    startOperation,
    endOperation,
    setOperationError,
  });

  const { actions: analysisActions } = useWorkspaceAnalysisMutations({
    authHeaders,
    currentWorkspaceId,
    queryClient,
    startOperation,
    endOperation,
    setOperationError,
  });

  // Memoize the action surface so consumers (the WorkspaceProvider context
  // value, every component that destructures useWorkspaceActions, every
  // mutation-fn closure that captures a specific action) keep a stable
  // identity across renders. Without this, the four-slice WorkspaceProvider
  // value churns every parent render and cascades through ~30 consumers.
  //
  // Deps explanation: TanStack's `*.mutateAsync` is referentially stable
  // across the parent's lifetime, so capturing each mutation by closure is
  // safe even though the mutation object itself is recreated. The values
  // that DO change between renders are `authHeaders`, `currentWorkspaceId`,
  // `queryClient`, and composed sub-action objects; those are listed below.
  // Listing every mutation ref would needlessly invalidate the memo each
  // render without a behaviour difference.
  const actions = useMemo(
    () => ({
      ...managementActions,
      ...graphActions,
      ...transformActions,
      ...analysisActions,
      /**
       * Gives table and graph consumers a guarded schema refresh action.
       * Consumed by: useWorkspaceNodeMutations return object for feature components.
       * Why: because feature components need one stable action facade for generated API mutations, cache refreshes, and operation state.
       * Flow: verify the node still exists, fetch fresh node info, normalize schema, and return null on stale nodes.
       */
      refreshNodeSchema: (nodeId: string) =>
        refreshWorkspaceNodeSchema({
          queryClient,
          workspaceId: currentWorkspaceId,
          nodeId,
          authHeaders,
        }),
    }),
    [
      analysisActions,
      authHeaders,
      currentWorkspaceId,
      graphActions,
      managementActions,
      queryClient,
      transformActions,
    ],
  );

  return { actions } as const;
};
