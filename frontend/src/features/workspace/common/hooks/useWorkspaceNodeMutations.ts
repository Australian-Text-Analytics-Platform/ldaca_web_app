import { useMemo } from 'react';
import { type QueryClient } from '@tanstack/react-query';
import { refreshWorkspaceNodeSchema } from './workspaceSchemaRefresh';
import { useWorkspaceAnalysisMutations } from './useWorkspaceAnalysisMutations';
import { useWorkspaceGraphMutations } from './useWorkspaceGraphMutations';
import { useWorkspaceManagementMutations } from './useWorkspaceManagementMutations';
import { useWorkspaceTransformMutations } from './useWorkspaceTransformMutations';

interface WorkspaceNodeMutationsParams {
  currentWorkspaceId: string | null;
  removeNode: (nodeId: string) => void;
  replaceSelectedNodes: (nodeIds: string[], activeNodeId?: string | null) => void;
  clearSelection: () => void;
  queryClient: QueryClient;
}

/**
 * Builds the workspace action surface from generated API mutations. The
 * provider exposes these methods to data-loader, graph, data-view, and analysis
 * features.
 * Used by: `useWorkspaceInternal`, which composes generated-API mutations with
 * semantic selection actions for the provider action slice.
 * Flow: the provider supplies workspace, selection, cache, and operation-lifecycle inputs; generated SDK mutations run, then lifecycle handlers update operation state, selection, and caches.
 */
export const useWorkspaceNodeMutations = ({
  currentWorkspaceId,
  removeNode,
  replaceSelectedNodes,
  clearSelection,
  queryClient,
}: WorkspaceNodeMutationsParams) => {
  const { actions: managementActions } = useWorkspaceManagementMutations({
    currentWorkspaceId,
    queryClient,
  });

  const { actions: graphActions } = useWorkspaceGraphMutations({
    currentWorkspaceId,
    removeNode,
    replaceSelectedNodes,
    clearSelection,
    queryClient,
  });

  const { actions: transformActions } = useWorkspaceTransformMutations({
    currentWorkspaceId,
    queryClient,
  });

  const { actions: analysisActions } = useWorkspaceAnalysisMutations({
    currentWorkspaceId,
    queryClient,
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
  // that DO change between renders are `currentWorkspaceId`, `queryClient`,
  // and composed sub-action objects; those are listed below.
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
       * Used by useWorkspaceDataTable and the Aggregate, Expression, and Replace
       * preprocessing flows after a schema-changing mutation.
       * Flow: verify the node still exists, then fetch its authoritative Arrow schema.
       */
      refreshNodeSchema: (nodeId: string) =>
        refreshWorkspaceNodeSchema({
          queryClient,
          workspaceId: currentWorkspaceId,
          nodeId,
        }),
    }),
    [
      analysisActions,
      currentWorkspaceId,
      graphActions,
      managementActions,
      queryClient,
      transformActions,
    ],
  );

  return { actions } as const;
};
