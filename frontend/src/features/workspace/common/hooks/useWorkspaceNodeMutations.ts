import { useMemo } from 'react';
import { type QueryClient, useMutation, isCancelledError } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  addNodeToWorkspace,
  castNode,
  cloneNode,
  concatNodes,
  concatNodesPreview,
  createWorkspace,
  deleteNode,
  deleteNodeColumn,
  deleteWorkspace,
  detachConcordance,
  detachConcordanceDispersion,
  detachQuotation,
  filterNode,
  filterPreview,
  getQuotation,
  joinNodes,
  listWorkspaces,
  materializeConcordance,
  materializeQuotation,
  polarsExpressionApply,
  polarsExpressionPreview,
  renameWorkspace,
  redoNodeOperation,
  renameNodeColumn,
  replaceApply,
  replacePreview,
  saveWorkspace,
  setCurrentWorkspace,
  sliceNode,
  slicePreview,
  undoNodeOperation,
  updateNodeName,
  updateWorkspaceDescription,
} from '@/api/generated/sdk.gen';
import type {
  FilterRequest as FilterRequestPayload,
  SliceRequest,
  ReplaceRequest,
  PolarsExpressionRequest,
  WorkspaceNodeInfo as NodeInfoResponse,
  ConcordanceDetachRequest,
  ConcordanceDispersionDetachRequest,
  ConcordanceMaterializeRequest,
  QuotationRequestInput,
  QuotationDetachRequest,
  QuotationMaterializeRequest,
} from '@/api/generated/types.gen';
import { ApiError } from '@/lib/apiError';
import { queryKeys } from '@/lib/queryKeys';
import { type NodeSchemaResponse } from '@/features/workspace/data-view/types';
import { type WorkspaceGraphResponse } from '@/api';
import { fetchNodeInfo, invalidateNodeInfoQuery } from '@/lib/nodeInfo';
import { normalizeSchemaFromInfo } from '@/hooks/useSchemaManagement';

type QuotationRequest = QuotationRequestInput;

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
    /**
   * Guards mutation paths that require an active workspace id.
     * Called by: useWorkspaceNodeMutations internal event, effect, or helper flow.
     * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
     */
  const ensureWorkspaceSelected = () => {
    if (!currentWorkspaceId) {
      throw new Error('No workspace selected');
    }
    return currentWorkspaceId;
  };

    /**
   * Refreshes workspace lists after mutations that alter workspace summaries.
     * Called by: useWorkspaceNodeMutations internal event, effect, or helper flow.
    * Why: because action helpers need one guard before they call generated APIs that require workspace context.
     */
  const invalidateWorkspaceSummaries = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
    queryClient.invalidateQueries({ queryKey: queryKeys.currentWorkspace });
  };

  /**
   * Synchronizes current workspace changes with the backend selection endpoint.
   * Called by: useWorkspaceNodeMutations internal event, effect, or helper flow.
   * Why: because workspace-level mutations need one cache refresh path for list and current-workspace summaries.
   * Flow: attempt to save the selected workspace, recover from stale server selection, then refresh summaries.
   */
  const setCurrentWorkspaceOnServer = async (workspaceId: string | null) => {
        /**
     * Reuses the generated selection call for both the primary attempt and recovery.
         * Called by: setCurrentWorkspaceOnServer internal event, effect, or helper flow.
         * Why: because the server-selection helper needs one retry path when the saved current workspace was deleted elsewhere.
         */
    const setCurrent = () =>
      setCurrentWorkspace({
        headers: authHeaders,
        query: workspaceId === null ? undefined : { workspace_id: workspaceId },
        throwOnError: true,
      });

    try {
      const { data } = await setCurrent();
      return data;
    } catch (error) {
      if (!(workspaceId !== null && error instanceof ApiError && error.status === 404)) {
        throw error;
      }

      await listWorkspaces({ headers: authHeaders, throwOnError: true });
      const { data } = await setCurrent();
      return data;
    }
  };

  const setCurrentWorkspaceMutation = useMutation<Record<string, unknown>, Error, string | null, { previousId: string | null }>({
        /**
     * Persists the selected workspace through backend current-workspace state.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
        * Why: because selection changes need one backend sync path with recovery for stale saved workspace ids.
         */
    mutationFn: (workspaceId: string | null) => setCurrentWorkspaceOnServer(workspaceId),
        /**
     * Starts selection tracking and cancels stale workspace-scoped work when clearing.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onMutate: async (workspaceId: string | null) => {
      startOperation('setCurrentWorkspace');
      const previousId = currentWorkspaceId;
      if (!workspaceId && previousId) {
        await queryClient.cancelQueries({
                    /**
           * Limits cancellation to queries derived from the workspace being cleared.
                     * Called by: queryClient.cancelQueries option object inside useWorkspaceNodeMutations.
                     * Why: because the cache operation needs a predicate that touches only the workspace queries being selected, refreshed, or cleared.
                     */
          predicate: ({ queryKey }) =>
            Array.isArray(queryKey) &&
            queryKey[0] === 'workspaces' &&
            queryKey[1] === previousId &&
            queryKey.length > 1,
        });
      }
      return { previousId };
    },
      /**
     * Mirrors confirmed selection into local context and refreshes affected caches.
       * Called by: useMutation option object inside useWorkspaceNodeMutations.
       * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
       * Flow: update local selection, clear node selection, then invalidate old and new workspace queries.
       */
    onSuccess: (_data, workspaceId, context) => {
      const previousId = context?.previousId ?? null;
      const nextId = workspaceId ?? null;
      // The selection store is canonical; the server query only bootstraps it.
      setCurrentWorkspaceId(nextId);
      clearSelection();

      if (nextId) {
        queryClient.invalidateQueries({
                    /**
           * Refreshes derived queries for the workspace that became current.
                     * Called by: queryClient.invalidateQueries option object inside useWorkspaceNodeMutations.
                     * Why: because the cache operation needs a predicate that touches only the workspace queries being selected, refreshed, or cleared.
                     */
          predicate: ({ queryKey }) =>
            Array.isArray(queryKey) &&
            queryKey[0] === 'workspaces' &&
            queryKey[1] === nextId &&
            queryKey.length > 1,
        });
      } else if (previousId) {
        queryClient.removeQueries({
                    /**
           * Drops detail queries for the workspace that is no longer selected.
                     * Called by: queryClient.removeQueries option object inside useWorkspaceNodeMutations.
                     * Why: because the cache operation needs a predicate that touches only the workspace queries being selected, refreshed, or cleared.
                     */
          predicate: ({ queryKey }) =>
            Array.isArray(queryKey) &&
            queryKey[0] === 'workspaces' &&
            queryKey[1] === previousId &&
            queryKey.length > 1,
        });
      }

      queryClient.invalidateQueries({ queryKey: queryKeys.currentWorkspace });
      endOperation('setCurrentWorkspace');
    },
        /**
     * Surfaces selection failures through the shared operation state.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onError: (error: Error) => {
      setOperationError('setCurrentWorkspace', error.message);
      endOperation('setCurrentWorkspace');
    },
  });

  const createWorkspaceMutation = useMutation({
        /**
     * Creates a workspace and lets the backend mark it current.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    mutationFn: ({ name, description }: { name: string; description?: string }) =>
      createWorkspace({
        body: { name, description: description || '' },
        headers: authHeaders,
        throwOnError: true,
      }).then(({ data }) => data),
        /**
     * Opens the shared pending state for create-workspace UI affordances.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onMutate: () => {
      startOperation('createWorkspace');
    },
        /**
     * Loads the new workspace immediately after the server confirms creation.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onSuccess: (data) => {
      const newWorkspaceId = (data?.id as string | undefined) ?? null;
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
      if (newWorkspaceId) {
        // Backend already marks the new workspace as current; sync the
        // client store so the UI auto-loads it without an extra click.
        setCurrentWorkspaceId(newWorkspaceId);
        clearSelection();
        queryClient.invalidateQueries({ queryKey: queryKeys.currentWorkspace });
      }
      endOperation('createWorkspace');
    },
        /**
     * Reports create-workspace failures to the operation banner.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onError: (error: Error) => {
      setOperationError('createWorkspace', error.message);
      endOperation('createWorkspace');
    },
  });

  const deleteWorkspaceMutation = useMutation({
        /**
     * Deletes a specific workspace through the generated API contract.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    mutationFn: (workspaceId: string) => {
      if (!workspaceId?.trim()) {
        throw new Error('workspaceId is required');
      }
      return deleteWorkspace({
        headers: authHeaders,
        query: { workspace_id: workspaceId },
        throwOnError: true,
      }).then(({ data }) => data);
    },
        /**
     * Marks destructive workspace removal as in progress for shared UI state.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onMutate: () => {
      startOperation('deleteWorkspace');
    },
        /**
     * Clears local selection when the current workspace was removed.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onSuccess: (data: Record<string, unknown>, workspaceId) => {
      const deletedWorkspaceId = (data?.id as string | undefined) ?? workspaceId;
      if (currentWorkspaceId && deletedWorkspaceId === currentWorkspaceId) {
        setCurrentWorkspaceId(null);
        clearSelection();
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
      queryClient.invalidateQueries({ queryKey: queryKeys.currentWorkspace });
      endOperation('deleteWorkspace');
    },
        /**
     * Routes deletion failures into the workspace operation error state.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onError: (error: Error) => {
      setOperationError('deleteWorkspace', error.message);
      endOperation('deleteWorkspace');
    },
  });

  const saveWorkspaceMutation = useMutation({
        /**
     * Saves the active workspace after verifying one is selected.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    mutationFn: () => {
      ensureWorkspaceSelected();
      return saveWorkspace({ headers: authHeaders, throwOnError: true }).then(({ data }) => data);
    },
        /**
     * Exposes save progress to the provider operation state.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onMutate: () => startOperation('saveWorkspace'),
        /**
     * Closes save progress after the backend writes the workspace.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onSuccess: () => {
      endOperation('saveWorkspace');
    },
        /**
     * Keeps save failures visible to consumers of workspace status.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onError: (error: Error) => {
      setOperationError('saveWorkspace', error.message);
      endOperation('saveWorkspace');
    },
  });

  const updateWorkspaceNameMutation = useMutation({
        /**
     * Renames the active workspace through the backend summary endpoint.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    mutationFn: (newName: string) => {
      ensureWorkspaceSelected();
      return renameWorkspace({
        headers: authHeaders,
        query: { new_name: newName },
        throwOnError: true,
      }).then(({ data }) => data);
    },
        /**
     * Starts operation tracking for name edits from workspace chrome.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onMutate: () => startOperation('updateWorkspaceName'),
        /**
     * Refreshes workspace summary caches after a successful rename.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
      queryClient.invalidateQueries({ queryKey: queryKeys.currentWorkspace });
      endOperation('updateWorkspaceName');
    },
        /**
     * Reports rename failures without mutating local optimistic state.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onError: (error: Error) => {
      setOperationError('updateWorkspaceName', error.message);
      endOperation('updateWorkspaceName');
    },
  });

  const updateWorkspaceDescriptionMutation = useMutation({
        /**
     * Updates the active workspace description for detail and list consumers.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    mutationFn: (description: string) => {
      ensureWorkspaceSelected();
      return updateWorkspaceDescription({
        headers: authHeaders,
        query: { description },
        throwOnError: true,
      }).then(({ data }) => data);
    },
        /**
     * Tracks description edits in the shared operation registry.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onMutate: () => startOperation('updateWorkspaceDescription'),
        /**
     * Revalidates workspace metadata once the description is saved.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
      queryClient.invalidateQueries({ queryKey: queryKeys.currentWorkspace });
      endOperation('updateWorkspaceDescription');
    },
        /**
     * Preserves the description edit failure for UI error surfaces.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onError: (error: Error) => {
      setOperationError('updateWorkspaceDescription', error.message);
      endOperation('updateWorkspaceDescription');
    },
  });

  const renameNodeMutation = useMutation({
        /**
     * Sends node label edits to the backend graph model.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    mutationFn: ({ nodeId, newName }: { nodeId: string; newName: string }) =>
      updateNodeName({
        headers: authHeaders,
        path: { node_id: nodeId },
        query: { new_name: newName },
        throwOnError: true,
      }).then(({ data }) => data),
        /**
     * Marks node rename activity for controls that disable during operations.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onMutate: () => {
      startOperation('renameNode');
    },
        /**
     * Refreshes graph labels after the backend accepts a node rename.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onSuccess: () => {
      if (currentWorkspaceId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId) });
      }
      endOperation('renameNode');
    },
        /**
     * Reports node rename errors through the shared mutation status.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onError: (error: Error) => {
      setOperationError('renameNode', error.message);
      endOperation('renameNode');
    },
  });

  const copyNodeMutation = useMutation({
        /**
     * Clones a node while keeping the backend responsible for graph placement.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    mutationFn: ({ nodeId }: { nodeId: string }) =>
      cloneNode({
        headers: authHeaders,
        path: { node_id: nodeId },
        throwOnError: true,
      }).then(({ data }) => data),
        /**
     * Marks clone work as pending for graph and toolbar consumers.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onMutate: () => {
      startOperation('copyNode');
    },
        /**
     * Revalidates graph and summaries so the cloned node becomes visible.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onSuccess: () => {
      if (currentWorkspaceId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId) });
      }
      invalidateWorkspaceSummaries();
      endOperation('copyNode');
    },
        /**
     * Captures clone failures for the operation status UI.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onError: (error: Error) => {
      setOperationError('copyNode', error.message);
      endOperation('copyNode');
    },
  });

  const deleteNodeMutation = useMutation({
        /**
     * Removes a node from the backend graph model.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    mutationFn: ({ nodeId }: { nodeId: string }) =>
      deleteNode({
        headers: authHeaders,
        path: { node_id: nodeId },
        throwOnError: true,
      }).then(({ data }) => data),
        /**
     * Marks node deletion as pending for graph controls.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onMutate: () => {
      startOperation('deleteNode');
    },
        /**
     * Clears deleted-node selection and refreshes graph/data caches.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onSuccess: (_, { nodeId }) => {
      if (selectedNodeId === nodeId) {
        clearSelection();
      }
      if (currentWorkspaceId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.nodeData(currentWorkspaceId, nodeId) });
      }
      invalidateWorkspaceSummaries();
      endOperation('deleteNode');
    },
        /**
     * Reports backend delete failures without changing local selection.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onError: (error: Error) => {
      setOperationError('deleteNode', error.message);
      endOperation('deleteNode');
    },
  });

  const undoNodeMutation = useMutation({
        /**
     * Asks the backend to revert the latest operation for one node.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    mutationFn: ({ nodeId }: { nodeId: string }) => undoNodeOperation({
      headers: authHeaders,
      path: { node_id: nodeId },
      throwOnError: true,
    }).then(({ data }) => data),
        /**
     * Opens undo progress for node history controls.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onMutate: () => {
      startOperation('undoNode');
    },
        /**
     * Revalidates graph, data, and schema after undo rewrites node state.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onSuccess: (_data, variables) => {
      if (currentWorkspaceId) {
        invalidateNodeInfoQuery(queryClient, currentWorkspaceId, variables.nodeId);
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.nodeData(currentWorkspaceId, variables.nodeId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.nodeSchema(currentWorkspaceId, variables.nodeId) });
      }
      endOperation('undoNode');
    },
        /**
     * Surfaces undo failures while leaving current caches untouched.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onError: (error: Error) => {
      setOperationError('undoNode', error.message);
      endOperation('undoNode');
    },
  });

  const redoNodeMutation = useMutation({
        /**
     * Reapplies a backend node operation previously undone.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    mutationFn: ({ nodeId }: { nodeId: string }) => redoNodeOperation({
      headers: authHeaders,
      path: { node_id: nodeId },
      throwOnError: true,
    }).then(({ data }) => data),
        /**
     * Opens redo progress for node history controls.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onMutate: () => {
      startOperation('redoNode');
    },
        /**
     * Revalidates graph, data, and schema after redo rewrites node state.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onSuccess: (_data, variables) => {
      if (currentWorkspaceId) {
        invalidateNodeInfoQuery(queryClient, currentWorkspaceId, variables.nodeId);
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.nodeData(currentWorkspaceId, variables.nodeId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.nodeSchema(currentWorkspaceId, variables.nodeId) });
      }
      endOperation('redoNode');
    },
        /**
     * Surfaces redo failures while preserving the current node view.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onError: (error: Error) => {
      setOperationError('redoNode', error.message);
      endOperation('redoNode');
    },
  });

  const createNodeMutation = useMutation({
        /**
     * Imports a source file or sheet into the active workspace graph.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    mutationFn: ({
      filename,
      sheetName,
    }: {
      filename: string;
      sheetName?: string;
    }) =>
      addNodeToWorkspace({
        headers: authHeaders,
        query: {
          filename,
          mode: 'LazyFrame',
          ...(sheetName ? { sheet_name: sheetName } : {}),
        },
        throwOnError: true,
      }).then(({ data }) => data),
        /**
     * Tracks file-import progress for loader and graph consumers.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onMutate: () => {
      startOperation('createNode');
    },
      /**
     * Refreshes graph state and reports dtype normalization after import.
       * Called by: useMutation option object inside useWorkspaceNodeMutations.
       * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
       * Flow: invalidate graph summaries, surface dtype normalization, and finish the import operation.
       */
    onSuccess: (response: NodeInfoResponse) => {
      if (currentWorkspaceId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId) });
      }
      invalidateWorkspaceSummaries();
      const changes = response?.dtype_normalization;
      if (changes && changes.length > 0) {
        const lines = changes.map(
          (c) => `${c.column}: ${c.from_dtype} → ${c.to_dtype} (${c.reason})`,
        );
        const heading =
          changes.length === 1
            ? '1 column was normalized to the standard dtype'
            : `${changes.length} columns were normalized to standard dtypes`;
        toast.info(heading, {
          description: lines.join('\n'),
          duration: 10000,
        });
      }
      endOperation('createNode');
    },
        /**
     * Reports file-import failures through the shared operation channel.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onError: (error: Error) => {
      setOperationError('createNode', error.message);
      endOperation('createNode');
    },
  });

  const joinNodesMutation = useMutation({
    /**
     * Sends join configuration to the backend and returns the created node.
     * Called by: useMutation option object inside useWorkspaceNodeMutations.
     * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
     * Flow: map UI join fields into generated API query parameters, preserve optional node name, and request a thrown error for mutation handling.
     */
    mutationFn: ({
      leftNodeId,
      rightNodeId,
      joinType,
      leftColumns,
      rightColumns,
      newNodeName,
    }: {
      leftNodeId: string;
      rightNodeId: string;
      joinType: string;
      leftColumns: string[];
      rightColumns: string[];
      newNodeName?: string;
    }) => {
      const request = {
        left_node_id: leftNodeId,
        right_node_id: rightNodeId,
        left_on: leftColumns[0] || '',
        right_on: rightColumns[0] || '',
        how: joinType as 'inner' | 'left' | 'right' | 'full' | 'semi' | 'anti' | 'cross',
        new_node_name: newNodeName,
      };
      return joinNodes({
        headers: authHeaders,
        query: request,
        throwOnError: true,
      }).then(({ data }) => data);
    },
        /**
     * Captures the pre-join graph so the new node can be selected afterward.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onMutate: () => {
      startOperation('joinNodes');
      const previousGraph = currentWorkspaceId
        ? queryClient.getQueryData<WorkspaceGraphResponse>(queryKeys.workspaceGraph(currentWorkspaceId))
        : undefined;
      const previousNodeIds = (previousGraph?.nodes || []).map((node) => node.id);
      clearSelection();
      return { previousNodeIds };
    },
      /**
     * Selects the joined node and refreshes graph data for downstream panels.
       * Called by: useMutation option object inside useWorkspaceNodeMutations.
       * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
       * Flow: infer the created node id, select it when found, refresh graph data, and close the join operation.
       */
    onSuccess: async (createdNode: Record<string, unknown>, _vars, context) => {
      let newId = (createdNode?.node_id as string | undefined) || (createdNode?.id as string | undefined);
      if (!newId && currentWorkspaceId) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId) });
        const freshGraph = queryClient.getQueryData<WorkspaceGraphResponse>(queryKeys.workspaceGraph(currentWorkspaceId));
        if (freshGraph?.nodes) {
          const prevIds = context?.previousNodeIds || [];
          const diff = freshGraph.nodes.map((node) => node.id).filter((id) => !prevIds.includes(id));
          if (diff.length === 1) newId = diff[0];
        }
      }
      if (newId) {
        setSelectedNodes([newId]);
      } else {
        clearSelection();
      }
      if (currentWorkspaceId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId) });
      }
      endOperation('joinNodes');
    },
        /**
     * Captures join failures for the shared operation error surface.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onError: (error: Error) => {
      setOperationError('joinNodes', error.message);
      endOperation('joinNodes');
    },
  });

  const concatNodesMutation = useMutation({
        /**
     * Sends concat options to the backend to materialize a combined node.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    mutationFn: ({ nodeIds, newNodeName, deduplicate }: { nodeIds: string[]; newNodeName?: string; deduplicate?: boolean }) =>
      concatNodes({
        body: { node_ids: nodeIds, new_node_name: newNodeName, deduplicate },
        headers: authHeaders,
        throwOnError: true,
      }).then(({ data }) => data),
        /**
     * Records the graph before concat so the created node can be inferred.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onMutate: () => {
      startOperation('concatNodes');
      const previousGraph = currentWorkspaceId
        ? queryClient.getQueryData<WorkspaceGraphResponse>(queryKeys.workspaceGraph(currentWorkspaceId))
        : undefined;
      const previousNodeIds = (previousGraph?.nodes || []).map((node) => node.id);
      clearSelection();
      return { previousNodeIds };
    },
      /**
     * Selects the concat result and refreshes graph state for consumers.
       * Called by: useMutation option object inside useWorkspaceNodeMutations.
       * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
       * Flow: infer the created node id, select it when found, refresh graph data, and close the concat operation.
       */
    onSuccess: async (createdNode: Record<string, unknown>, _vars, context) => {
      let newId = (createdNode?.node_id as string | undefined) || (createdNode?.id as string | undefined);
      if (!newId && currentWorkspaceId) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId) });
        const freshGraph = queryClient.getQueryData<WorkspaceGraphResponse>(queryKeys.workspaceGraph(currentWorkspaceId));
        if (freshGraph?.nodes) {
          const prevIds = context?.previousNodeIds || [];
          const diff = freshGraph.nodes.map((node) => node.id).filter((id) => !prevIds.includes(id));
          if (diff.length === 1) newId = diff[0];
        }
      }
      if (newId) {
        setSelectedNodes([newId]);
      } else {
        clearSelection();
      }
      if (currentWorkspaceId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId) });
      }
      endOperation('concatNodes');
    },
        /**
     * Reports concat failures through shared operation status.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onError: (error: Error) => {
      setOperationError('concatNodes', error.message);
      endOperation('concatNodes');
    },
  });

  const filterNodeMutation = useMutation({
        /**
     * Applies a persisted row filter to one backend node.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    mutationFn: ({ nodeId, request }: { nodeId: string; request: FilterRequestPayload }) =>
      filterNode({
        body: request,
        headers: authHeaders,
        path: { node_id: nodeId },
        throwOnError: true,
      }).then(() => undefined),
        /**
     * Marks filter application as active for toolbar state.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onMutate: () => {
      startOperation('filterNode');
    },
        /**
     * Refreshes the graph after filtering creates or updates a node.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onSuccess: () => {
      if (currentWorkspaceId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId) });
      }
      endOperation('filterNode');
    },
        /**
     * Reports filter application failures to the operation registry.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onError: (error: Error) => {
      setOperationError('filterNode', error.message);
      endOperation('filterNode');
    },
  });

  const replaceTextMutation = useMutation({
        /**
     * Applies a text replacement request against one backend node.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    mutationFn: ({ nodeId, request }: { nodeId: string; request: ReplaceRequest }) =>
      replaceApply({
        body: request,
        headers: authHeaders,
        path: { node_id: nodeId },
        throwOnError: true,
      }).then(({ data }) => data),
        /**
     * Marks replacement work as active for workspace controls.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onMutate: () => {
      startOperation('replaceText');
    },
        /**
     * Revalidates graph, data, and schema after text replacement.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onSuccess: (_response, variables) => {
      if (currentWorkspaceId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId) });
        if (variables?.nodeId) {
          queryClient.invalidateQueries({ queryKey: queryKeys.nodeData(currentWorkspaceId, variables.nodeId) });
          queryClient.invalidateQueries({ queryKey: queryKeys.nodeSchema(currentWorkspaceId, variables.nodeId) });
        }
      }
      endOperation('replaceText');
    },
        /**
     * Reports replacement failures through shared operation status.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onError: (error: Error) => {
      setOperationError('replaceText', error.message);
      endOperation('replaceText');
    },
  });

  const sliceNodeMutation = useMutation({
        /**
     * Persists a slice operation for one node through the backend.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    mutationFn: ({ nodeId, request }: { nodeId: string; request: SliceRequest }) =>
      sliceNode({
        body: request,
        headers: authHeaders,
        path: { node_id: nodeId },
        throwOnError: true,
      }).then(({ data }) => data),
        /**
     * Marks slice application as active for shared mutation state.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onMutate: () => {
      startOperation('sliceNode');
    },
        /**
     * Refreshes the graph after slice application changes node lineage.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onSuccess: () => {
      if (currentWorkspaceId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId) });
      }
      endOperation('sliceNode');
    },
        /**
     * Captures slice failures for operation-aware UI surfaces.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onError: (error: Error) => {
      setOperationError('sliceNode', error.message);
      endOperation('sliceNode');
    },
  });

  const castNodeMutation = useMutation({
        /**
     * Requests a backend dtype cast for one node column.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    mutationFn: ({ nodeId, column, targetType, format }: { nodeId: string; column: string; targetType: string; format?: string }) =>
      castNode({
        body: { column, target_type: targetType, format },
        headers: authHeaders,
        path: { node_id: nodeId },
        throwOnError: true,
      }).then(({ data }) => data),
        /**
     * Marks column casting as active for workspace mutation controls.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onMutate: () => {
      startOperation('castNode');
    },
        /**
     * Revalidates node metadata after a cast can change schema and data.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onSuccess: (_data, variables) => {
      if (currentWorkspaceId && variables?.nodeId) {
        invalidateNodeInfoQuery(queryClient, currentWorkspaceId, variables.nodeId);
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.nodeData(currentWorkspaceId, variables.nodeId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.nodeSchema(currentWorkspaceId, variables.nodeId) });
      }
      endOperation('castNode');
    },
        /**
     * Routes cast failures into the shared operation error state.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onError: (error: Error) => {
      setOperationError('castNode', error.message);
      endOperation('castNode');
    },
  });

  const renameColumnMutation = useMutation({
        /**
     * Sends a column rename request for the selected node table.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    mutationFn: ({ nodeId, column, newName }: { nodeId: string; column: string; newName: string }) =>
      renameNodeColumn({
        body: { new_name: newName },
        headers: authHeaders,
        path: { column_name: column, node_id: nodeId },
        throwOnError: true,
      }).then(({ data }) => data),
        /**
     * Marks column rename progress for data-table controls.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onMutate: () => {
      startOperation('renameColumn');
    },
        /**
     * Refreshes graph, data, and schema after the backend renames a column.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onSuccess: (_data, variables) => {
      if (currentWorkspaceId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId) });
        if (variables?.nodeId) {
          queryClient.invalidateQueries({ queryKey: queryKeys.nodeData(currentWorkspaceId, variables.nodeId) });
          queryClient.invalidateQueries({ queryKey: queryKeys.nodeSchema(currentWorkspaceId, variables.nodeId) });
        }
      }
      endOperation('renameColumn');
    },
        /**
     * Records column rename failures for operation consumers.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onError: (error: Error) => {
      setOperationError('renameColumn', error.message);
      endOperation('renameColumn');
    },
  });

  const deleteColumnMutation = useMutation({
        /**
     * Deletes one column from a node through the backend table endpoint.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    mutationFn: ({ nodeId, column }: { nodeId: string; column: string }) =>
      deleteNodeColumn({
        headers: authHeaders,
        path: { column_name: column, node_id: nodeId },
        throwOnError: true,
      }).then(({ data }) => data),
        /**
     * Marks column deletion as active for the data table.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onMutate: () => {
      startOperation('deleteColumn');
    },
        /**
     * Refreshes table and schema caches after a column is removed.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onSuccess: (_data, variables) => {
      if (currentWorkspaceId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId) });
        if (variables?.nodeId) {
          queryClient.invalidateQueries({ queryKey: queryKeys.nodeData(currentWorkspaceId, variables.nodeId) });
          queryClient.invalidateQueries({ queryKey: queryKeys.nodeSchema(currentWorkspaceId, variables.nodeId) });
        }
      }
      endOperation('deleteColumn');
    },
        /**
     * Keeps column deletion failures visible to the operation UI.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onError: (error: Error) => {
      setOperationError('deleteColumn', error.message);
      endOperation('deleteColumn');
    },
  });

  // ---- Text-analysis mutations. ----

  const detachConcordanceMutation = useMutation({
        /**
     * Detaches concordance output into the workspace graph.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    mutationFn: ({
      nodeId,
      request,
    }: {
      workspaceId: string;
      nodeId: string;
      request: ConcordanceDetachRequest;
    }) => detachConcordance({
      body: request,
      headers: authHeaders,
      path: { node_id: nodeId },
      throwOnError: true,
    }).then(({ data }) => data),
        /**
     * Tracks concordance detach work for analysis controls.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onMutate: () => startOperation('detachConcordance'),
        /**
     * Refreshes graph lineage after concordance detach adds nodes.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(variables.workspaceId) });
      endOperation('detachConcordance');
    },
        /**
     * Reports concordance detach failures to shared operation status.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onError: (error: Error) => {
      setOperationError('detachConcordance', error.message);
      endOperation('detachConcordance');
    },
  });

  const detachConcordanceDispersionMutation = useMutation({
        /**
     * Starts a dispersion detach task and normalizes its task id response.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    mutationFn: ({
      nodeId,
      request,
    }: {
      workspaceId: string;
      nodeId: string;
      request: ConcordanceDispersionDetachRequest;
    }) =>
      detachConcordanceDispersion({
        body: request,
        headers: authHeaders,
        path: { node_id: nodeId },
        throwOnError: true,
      }).then(({ data }) => ({ task_id: data.metadata?.task_id ?? undefined })),
        /**
     * Tracks dispersion detach progress for analysis consumers.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onMutate: () => startOperation('detachConcordanceDispersion'),
        /**
     * Revalidates graph state after dispersion detach is accepted.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(variables.workspaceId) });
      endOperation('detachConcordanceDispersion');
    },
        /**
     * Surfaces dispersion detach failures in operation status.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onError: (error: Error) => {
      setOperationError('detachConcordanceDispersion', error.message);
      endOperation('detachConcordanceDispersion');
    },
  });

  const materializeConcordanceMutation = useMutation({
        /**
     * Persists a concordance analysis result back into a workspace node.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    mutationFn: ({
      nodeId,
      request,
    }: {
      nodeId: string;
      request: ConcordanceMaterializeRequest;
    }) => materializeConcordance({
      body: request,
      headers: authHeaders,
      path: { node_id: nodeId },
      throwOnError: true,
    }).then(({ data }) => data),
        /**
     * Marks concordance materialization as active for analysis UI state.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onMutate: () => startOperation('materializeConcordance'),
        /**
     * Ends materialization progress once the backend accepts the request.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onSuccess: () => {
      endOperation('materializeConcordance');
    },
        /**
     * Reports concordance materialization failures through operation state.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onError: (error: Error) => {
      setOperationError('materializeConcordance', error.message);
      endOperation('materializeConcordance');
    },
  });

  const quotationMutation = useMutation({
        /**
     * Runs quotation search against one source node.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    mutationFn: ({
      nodeId,
      request,
    }: {
      nodeId: string;
      request: QuotationRequest;
    }) => getQuotation({
      body: request,
      headers: authHeaders,
      path: { node_id: nodeId },
      throwOnError: true,
    }).then(({ data }) => data),
        /**
     * Marks quotation search as active for analysis controls.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onMutate: () => startOperation('quotation'),
        /**
     * Closes quotation progress once results arrive.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onSuccess: () => {
      endOperation('quotation');
    },
        /**
     * Captures quotation search failures for shared operation status.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onError: (error: Error) => {
      setOperationError('quotation', error.message);
      endOperation('quotation');
    },
  });

  const detachQuotationMutation = useMutation({
        /**
     * Detaches quotation results into workspace graph artifacts.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    mutationFn: ({
      nodeId,
      request,
    }: {
      workspaceId: string;
      nodeId: string;
      request: QuotationDetachRequest;
    }) => detachQuotation({
      body: request,
      headers: authHeaders,
      path: { node_id: nodeId },
      throwOnError: true,
    }).then(({ data }) => data),
        /**
     * Tracks quotation detach progress for analysis-side actions.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onMutate: () => startOperation('detachQuotation'),
        /**
     * Refreshes graph lineage after quotation detach adds nodes.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(variables.workspaceId) });
      endOperation('detachQuotation');
    },
        /**
     * Reports quotation detach failures through the operation registry.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onError: (error: Error) => {
      setOperationError('detachQuotation', error.message);
      endOperation('detachQuotation');
    },
  });

  const materializeQuotationMutation = useMutation({
        /**
     * Persists quotation analysis results back into a workspace node.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    mutationFn: ({
      nodeId,
      request,
    }: {
      nodeId: string;
      request: QuotationMaterializeRequest;
    }) => materializeQuotation({
      body: request,
      headers: authHeaders,
      path: { node_id: nodeId },
      throwOnError: true,
    }).then(({ data }) => data),
        /**
     * Marks quotation materialization as active for analysis UI state.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onMutate: () => startOperation('materializeQuotation'),
        /**
     * Ends quotation materialization progress after backend acceptance.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onSuccess: () => {
      endOperation('materializeQuotation');
    },
        /**
     * Keeps quotation materialization failures visible to consumers.
         * Called by: useMutation option object inside useWorkspaceNodeMutations.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    onError: (error: Error) => {
      setOperationError('materializeQuotation', error.message);
      endOperation('materializeQuotation');
    },
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
  // and `queryClient`; those are listed below. Listing the 20 mutation refs
  // would needlessly invalidate the memo each render without a behaviour
  // difference.
  const actions = useMemo(() => ({
        /**
     * Lets provider consumers switch or clear the active workspace.
         * Consumed by: useWorkspaceNodeMutations return object for feature components.
         * Why: because feature components need one stable action facade for generated API mutations, cache refreshes, and operation state.
         */
    setCurrentWorkspace: (workspaceId: string | null) => setCurrentWorkspaceMutation.mutateAsync(workspaceId),
        /**
     * Exposes workspace creation to launch and workspace-list UI.
         * Consumed by: useWorkspaceNodeMutations return object for feature components.
         * Why: because feature components need one stable action facade for generated API mutations, cache refreshes, and operation state.
         */
    createWorkspace: (name: string, description?: string) => createWorkspaceMutation.mutateAsync({ name, description }),
        /**
     * Exposes workspace deletion to list and settings actions.
         * Consumed by: useWorkspaceNodeMutations return object for feature components.
         * Why: because feature components need one stable action facade for generated API mutations, cache refreshes, and operation state.
         */
    deleteWorkspace: (workspaceId: string) => deleteWorkspaceMutation.mutateAsync(workspaceId),
        /**
     * Gives save controls a single action for persisting the current workspace.
         * Consumed by: useWorkspaceNodeMutations return object for feature components.
         * Why: because feature components need one stable action facade for generated API mutations, cache refreshes, and operation state.
         */
    saveWorkspace: () => saveWorkspaceMutation.mutateAsync(),
        /**
     * Gives header editing UI a stable workspace rename action.
         * Consumed by: useWorkspaceNodeMutations return object for feature components.
         * Why: because feature components need one stable action facade for generated API mutations, cache refreshes, and operation state.
         */
    renameWorkspace: (newName: string) => updateWorkspaceNameMutation.mutateAsync(newName),
        /**
     * Lets workspace metadata panels persist description edits.
         * Consumed by: useWorkspaceNodeMutations return object for feature components.
         * Why: because feature components need one stable action facade for generated API mutations, cache refreshes, and operation state.
         */
    updateWorkspaceDescription: (description: string) => updateWorkspaceDescriptionMutation.mutateAsync(description),
        /**
     * Lets graph and table chrome rename a node through the shared mutation.
         * Consumed by: useWorkspaceNodeMutations return object for feature components.
         * Why: because feature components need one stable action facade for generated API mutations, cache refreshes, and operation state.
         */
    renameNode: (nodeId: string, newName: string) =>
      renameNodeMutation.mutateAsync({ nodeId, newName }),
        /**
     * Lets node history controls revert the selected node state.
         * Consumed by: useWorkspaceNodeMutations return object for feature components.
         * Why: because feature components need one stable action facade for generated API mutations, cache refreshes, and operation state.
         */
    undoNode: (nodeId: string) =>
      undoNodeMutation.mutateAsync({ nodeId }),
        /**
     * Lets node history controls reapply a reverted node state.
         * Consumed by: useWorkspaceNodeMutations return object for feature components.
         * Why: because feature components need one stable action facade for generated API mutations, cache refreshes, and operation state.
         */
    redoNode: (nodeId: string) =>
      redoNodeMutation.mutateAsync({ nodeId }),
        /**
     * Lets graph actions duplicate a node without knowing mutation wiring.
         * Consumed by: useWorkspaceNodeMutations return object for feature components.
         * Why: because feature components need one stable action facade for generated API mutations, cache refreshes, and operation state.
         */
    copyNode: (nodeId: string) =>
      copyNodeMutation.mutateAsync({ nodeId }),
        /**
     * Lets graph actions remove a node through the shared mutation.
         * Consumed by: useWorkspaceNodeMutations return object for feature components.
         * Why: because feature components need one stable action facade for generated API mutations, cache refreshes, and operation state.
         */
    deleteNode: (nodeId: string) =>
      deleteNodeMutation.mutateAsync({ nodeId }),
        /**
     * Lets file-loading UI add a workspace node from a selected file or sheet.
         * Consumed by: useWorkspaceNodeMutations return object for feature components.
         * Why: because feature components need one stable action facade for generated API mutations, cache refreshes, and operation state.
         */
    createNodeFromFile: (filename: string, sheetName?: string) =>
      createNodeMutation.mutateAsync({
        filename,
        sheetName,
      }),
        /**
     * Lets join dialogs pass user-selected join configuration to the mutation.
         * Consumed by: useWorkspaceNodeMutations return object for feature components.
         * Why: because feature components need one stable action facade for generated API mutations, cache refreshes, and operation state.
         */
    joinNodes: (
      leftNodeId: string,
      rightNodeId: string,
      joinType: string,
      leftColumns: string[],
      rightColumns: string[],
      newNodeName?: string
    ) =>
      joinNodesMutation.mutateAsync({
        leftNodeId,
        rightNodeId,
        joinType,
        leftColumns,
        rightColumns,
        newNodeName,
      }),
        /**
     * Lets concat dialogs materialize selected nodes into a new node.
         * Consumed by: useWorkspaceNodeMutations return object for feature components.
         * Why: because feature components need one stable action facade for generated API mutations, cache refreshes, and operation state.
         */
    concatNodes: (nodeIds: string[], newNodeName?: string, deduplicate?: boolean) =>
      concatNodesMutation.mutateAsync({ nodeIds, newNodeName, deduplicate }),
        /**
     * Gives concat dialogs a paged preview action without mutating the graph.
         * Consumed by: useWorkspaceNodeMutations return object for feature components.
         * Why: because feature components need one stable action facade for generated API mutations, cache refreshes, and operation state.
         */
    concatPreview: (nodeIds: string[], page = 1, pageSize = 10, deduplicate?: boolean) =>
      concatNodesPreview({
        body: { node_ids: nodeIds, deduplicate },
        headers: authHeaders,
        query: { page, page_size: pageSize },
        throwOnError: true,
      }).then(({ data }) => data),
        /**
     * Lets filter forms persist a filter as a graph operation.
         * Consumed by: useWorkspaceNodeMutations return object for feature components.
         * Why: because feature components need one stable action facade for generated API mutations, cache refreshes, and operation state.
         */
    filterNode: (nodeId: string, request: FilterRequestPayload) =>
      filterNodeMutation.mutateAsync({ nodeId, request }),
        /**
     * Gives filter forms a paged preview before committing the operation.
         * Consumed by: useWorkspaceNodeMutations return object for feature components.
         * Why: because feature components need one stable action facade for generated API mutations, cache refreshes, and operation state.
         */
    filterPreview: (nodeId: string, request: FilterRequestPayload, page = 1, pageSize = 10) =>
      filterPreview({
        body: request,
        headers: authHeaders,
        path: { node_id: nodeId },
        query: { page, page_size: pageSize },
        throwOnError: true,
      }).then(({ data }) => data),
        /**
     * Lets slice controls persist row slicing against a node.
         * Consumed by: useWorkspaceNodeMutations return object for feature components.
         * Why: because feature components need one stable action facade for generated API mutations, cache refreshes, and operation state.
         */
    sliceNode: (nodeId: string, request: SliceRequest) =>
      sliceNodeMutation.mutateAsync({ nodeId, request }),
        /**
     * Gives slice controls a paged preview before creating the operation.
         * Consumed by: useWorkspaceNodeMutations return object for feature components.
         * Why: because feature components need one stable action facade for generated API mutations, cache refreshes, and operation state.
         */
    slicePreview: (nodeId: string, request: SliceRequest, page = 1, pageSize = 10) =>
      slicePreview({
        body: request,
        headers: authHeaders,
        path: { node_id: nodeId },
        query: { page, page_size: pageSize },
        throwOnError: true,
      }).then(({ data }) => data),
        /**
     * Lets replace-text UI commit text replacement to a node.
         * Consumed by: useWorkspaceNodeMutations return object for feature components.
         * Why: because feature components need one stable action facade for generated API mutations, cache refreshes, and operation state.
         */
    replaceText: (nodeId: string, request: ReplaceRequest) =>
      replaceTextMutation.mutateAsync({ nodeId, request }),
        /**
     * Gives replace-text UI a paged preview before applying changes.
         * Consumed by: useWorkspaceNodeMutations return object for feature components.
         * Why: because feature components need one stable action facade for generated API mutations, cache refreshes, and operation state.
         */
    replaceTextPreview: (nodeId: string, request: ReplaceRequest, page = 1, pageSize = 10) =>
      replacePreview({
        body: request,
        headers: authHeaders,
        path: { node_id: nodeId },
        query: { page, page_size: pageSize },
        throwOnError: true,
      }).then(({ data }) => data),
        /**
     * Gives expression UI a paged preview for Polars transformations.
         * Consumed by: useWorkspaceNodeMutations return object for feature components.
         * Why: because feature components need one stable action facade for generated API mutations, cache refreshes, and operation state.
         */
    polarsExpressionPreview: (nodeId: string, request: PolarsExpressionRequest, page = 1, pageSize = 10) =>
      polarsExpressionPreview({
        body: request,
        headers: authHeaders,
        path: { node_id: nodeId },
        query: { page, page_size: pageSize },
        throwOnError: true,
      }).then(({ data }) => data),
        /**
     * Lets expression UI commit a Polars transformation to the graph.
         * Consumed by: useWorkspaceNodeMutations return object for feature components.
         * Why: because feature components need one stable action facade for generated API mutations, cache refreshes, and operation state.
         */
    polarsExpressionApply: (nodeId: string, request: PolarsExpressionRequest) =>
      polarsExpressionApply({
        body: request,
        headers: authHeaders,
        path: { node_id: nodeId },
        throwOnError: true,
      }).then(({ data }) => data),
        /**
     * Lets column menus cast a column while sharing schema invalidation.
         * Called by: useWorkspaceNodeMutations object consumers.
         * Why: because each TanStack mutation lifecycle step needs to connect generated API work with operation tracking, errors, and cache invalidation.
         */
    castColumn: (nodeId: string, column: string, targetType: string, format?: string) =>
      castNodeMutation.mutateAsync({ nodeId, column, targetType, format }),
        /**
     * Lets column headers persist a column rename.
         * Consumed by: useWorkspaceNodeMutations return object for feature components.
         * Why: because feature components need one stable action facade for generated API mutations, cache refreshes, and operation state.
         */
    renameColumn: (nodeId: string, column: string, newName: string) =>
      renameColumnMutation.mutateAsync({ nodeId, column, newName }),
        /**
     * Lets column menus remove a column through the shared mutation.
         * Consumed by: useWorkspaceNodeMutations return object for feature components.
         * Why: because feature components need one stable action facade for generated API mutations, cache refreshes, and operation state.
         */
    deleteColumn: (nodeId: string, column: string) => deleteColumnMutation.mutateAsync({ nodeId, column }),
        /**
     * Lets concordance analysis detach results into workspace nodes.
         * Consumed by: useWorkspaceNodeMutations return object for feature components.
         * Why: because feature components need one stable action facade for generated API mutations, cache refreshes, and operation state.
         */
    detachConcordance: (nodeId: string, request: ConcordanceDetachRequest) =>
      detachConcordanceMutation.mutateAsync({
        workspaceId: ensureWorkspaceSelected(),
        nodeId,
        request,
      }),
        /**
     * Lets dispersion analysis detach derived output while guarding workspace context.
         * Consumed by: useWorkspaceNodeMutations return object for feature components.
         * Why: because feature components need one stable action facade for generated API mutations, cache refreshes, and operation state.
         */
    detachConcordanceDispersion: (
      nodeId: string,
      request: ConcordanceDispersionDetachRequest,
    ) =>
      detachConcordanceDispersionMutation.mutateAsync({
        workspaceId: ensureWorkspaceSelected(),
        nodeId,
        request,
      }),
        /**
     * Lets concordance analysis materialize a selected result back into data.
         * Consumed by: useWorkspaceNodeMutations return object for feature components.
         * Why: because feature components need one stable action facade for generated API mutations, cache refreshes, and operation state.
         */
    materializeConcordance: (nodeId: string, request: ConcordanceMaterializeRequest) =>
      materializeConcordanceMutation.mutateAsync({
        nodeId,
        request,
      }),
        /**
     * Lets quotation analysis run a search against a source node.
         * Consumed by: useWorkspaceNodeMutations return object for feature components.
         * Why: because feature components need one stable action facade for generated API mutations, cache refreshes, and operation state.
         */
    quotationSearch: (nodeId: string, request: QuotationRequest) =>
      quotationMutation.mutateAsync({
        nodeId,
        request,
      }),
        /**
     * Lets quotation analysis detach results into workspace nodes.
         * Consumed by: useWorkspaceNodeMutations return object for feature components.
         * Why: because feature components need one stable action facade for generated API mutations, cache refreshes, and operation state.
         */
    detachQuotation: (nodeId: string, request: QuotationDetachRequest) =>
      detachQuotationMutation.mutateAsync({
        workspaceId: ensureWorkspaceSelected(),
        nodeId,
        request,
      }),
        /**
     * Lets quotation analysis materialize selected results back into data.
         * Consumed by: useWorkspaceNodeMutations return object for feature components.
         * Why: because feature components need one stable action facade for generated API mutations, cache refreshes, and operation state.
         */
    materializeQuotation: (nodeId: string, request: QuotationMaterializeRequest) =>
      materializeQuotationMutation.mutateAsync({
        nodeId,
        request,
      }),
      /**
     * Gives table and graph consumers a guarded schema refresh action.
       * Consumed by: useWorkspaceNodeMutations return object for feature components.
       * Why: because feature components need one stable action facade for generated API mutations, cache refreshes, and operation state.
       * Flow: verify the node still exists, fetch fresh node info, normalize schema, and return null on stale nodes.
       */
    refreshNodeSchema: async (nodeId: string): Promise<NodeSchemaResponse | null> => {
      if (!currentWorkspaceId) return null;
      const graphData = queryClient.getQueryData<WorkspaceGraphResponse>(queryKeys.workspaceGraph(currentWorkspaceId));
      const existingNodes = graphData?.nodes || [];
      const nodeExists = existingNodes.some((node) => node.id === nodeId);
      if (!nodeExists) {
        return null;
      }
      try {
        const info = await fetchNodeInfo({ queryClient, workspaceId: currentWorkspaceId, nodeId, headers: authHeaders, force: true });
        const schemaMap = normalizeSchemaFromInfo(info);
        const schema = schemaMap;
        return {
          node_id: nodeId,
          schema,
          columns: Object.keys(schema),
          column_types: schema,
          is_text_data: false,
        };
      } catch (error) {
        // `force: true` in fetchNodeInfo triggers removeQueries, which cancels
        // any inflight observer-driven query for the same key. TanStack throws
        // CancelledError in that race. TanStack's CancelledError sets
        // ``error.message === "CancelledError"`` but leaves ``error.name`` at
        // ``"Error"``, so use the exported type guard rather than name-sniffing.
        if (isCancelledError(error)) {
          return null;
        } else {
          console.error('Failed to refresh node schema:', error);
        }
        return null;
      }
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps -- see comment above; mutation refs are intentionally omitted because their mutateAsync identities are stable.
  }), [authHeaders, currentWorkspaceId, queryClient]);

  return { actions } as const;
};
