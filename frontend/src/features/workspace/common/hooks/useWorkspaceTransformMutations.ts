import { useMemo } from 'react';
import { type QueryClient, useMutation } from '@tanstack/react-query';
import {
  castNode,
  deleteNodeColumn,
  filterNode as applyFilterNode,
  filterPreview,
  polarsExpressionApply as applyPolarsExpression,
  polarsExpressionPreview,
  renameNodeColumn,
  replaceApply,
  replacePreview,
  sliceNode as applySliceNode,
  slicePreview,
} from '@/api';
import type {
  FilterRequest as FilterRequestPayload,
  PolarsExpressionRequest,
  ReplaceRequest,
  SliceRequest,
} from '@/api';
import {
  invalidateNodeWorkspaceQueries,
  invalidateWorkspaceGraphQuery,
} from './workspaceMutationCache';

interface WorkspaceTransformMutationsParams {
  authHeaders: Record<string, string>;
  currentWorkspaceId: string | null;
  queryClient: QueryClient;
  startOperation: (operationId: string) => void;
  endOperation: (operationId: string) => void;
  setOperationError: (operationId: string, error: string) => void;
}

/**
 * Owns preprocessing and column-edit actions exposed through WorkspaceProvider.
 * Used by: useWorkspaceNodeMutations because filter/slice/replace/expression
 * and column mutations share node-cache invalidation, but do not need to live
 * beside workspace selection or graph-combine mutations.
 * Flow: build mutation-backed apply actions, keep preview calls side-effect
 * free, invalidate graph/data/schema caches after writes, and return a stable
 * action object for preprocessing and table consumers.
 */
export const useWorkspaceTransformMutations = ({
  authHeaders,
  currentWorkspaceId,
  queryClient,
  startOperation,
  endOperation,
  setOperationError,
}: WorkspaceTransformMutationsParams) => {
  const ensureWorkspaceSelected = () => {
    if (!currentWorkspaceId) {
      throw new Error('No workspace selected');
    }
    return currentWorkspaceId;
  };

  const filterNodeMutation = useMutation({
    mutationFn: ({ nodeId, request }: { nodeId: string; request: FilterRequestPayload }) =>
      applyFilterNode({
        body: request,
        headers: authHeaders,
        path: { workspace_id: ensureWorkspaceSelected(), node_id: nodeId },
        throwOnError: true,
      }).then(() => undefined),
    onMutate: () => {
      startOperation('filterNode');
    },
    onSuccess: () => {
      invalidateWorkspaceGraphQuery(queryClient, currentWorkspaceId);
      endOperation('filterNode');
    },
    onError: (error: Error) => {
      setOperationError('filterNode', error.message);
      endOperation('filterNode');
    },
  });

  const replaceTextMutation = useMutation({
    mutationFn: ({ nodeId, request }: { nodeId: string; request: ReplaceRequest }) =>
      replaceApply({
        body: request,
        headers: authHeaders,
        path: { workspace_id: ensureWorkspaceSelected(), node_id: nodeId },
        throwOnError: true,
      }).then(({ data }) => data),
    onMutate: () => {
      startOperation('replaceText');
    },
    onSuccess: (_response, variables) => {
      invalidateNodeWorkspaceQueries(queryClient, currentWorkspaceId, variables.nodeId, {
        includeData: true,
        includeSchema: true,
      });
      endOperation('replaceText');
    },
    onError: (error: Error) => {
      setOperationError('replaceText', error.message);
      endOperation('replaceText');
    },
  });

  const sliceNodeMutation = useMutation({
    mutationFn: ({ nodeId, request }: { nodeId: string; request: SliceRequest }) =>
      applySliceNode({
        body: request,
        headers: authHeaders,
        path: { workspace_id: ensureWorkspaceSelected(), node_id: nodeId },
        throwOnError: true,
      }).then(({ data }) => data),
    onMutate: () => {
      startOperation('sliceNode');
    },
    onSuccess: () => {
      invalidateWorkspaceGraphQuery(queryClient, currentWorkspaceId);
      endOperation('sliceNode');
    },
    onError: (error: Error) => {
      setOperationError('sliceNode', error.message);
      endOperation('sliceNode');
    },
  });

  const castNodeMutation = useMutation({
    mutationFn: ({
      nodeId,
      column,
      targetType,
      format,
    }: {
      nodeId: string;
      column: string;
      targetType: string;
      format?: string;
    }) =>
      castNode({
        body: { column, target_type: targetType, format },
        headers: authHeaders,
        path: { workspace_id: ensureWorkspaceSelected(), node_id: nodeId },
        throwOnError: true,
      }).then(({ data }) => data),
    onMutate: () => {
      startOperation('castNode');
    },
    onSuccess: (_data, variables) => {
      invalidateNodeWorkspaceQueries(queryClient, currentWorkspaceId, variables.nodeId, {
        includeNodeInfo: true,
        includeData: true,
        includeSchema: true,
      });
      endOperation('castNode');
    },
    onError: (error: Error) => {
      setOperationError('castNode', error.message);
      endOperation('castNode');
    },
  });

  const renameColumnMutation = useMutation({
    mutationFn: ({
      nodeId,
      column,
      newName,
    }: {
      nodeId: string;
      column: string;
      newName: string;
    }) =>
      renameNodeColumn({
        body: { new_name: newName },
        headers: authHeaders,
        path: { workspace_id: ensureWorkspaceSelected(), column_name: column, node_id: nodeId },
        throwOnError: true,
      }).then(({ data }) => data),
    onMutate: () => {
      startOperation('renameColumn');
    },
    onSuccess: (_data, variables) => {
      invalidateNodeWorkspaceQueries(queryClient, currentWorkspaceId, variables.nodeId, {
        includeData: true,
        includeSchema: true,
      });
      endOperation('renameColumn');
    },
    onError: (error: Error) => {
      setOperationError('renameColumn', error.message);
      endOperation('renameColumn');
    },
  });

  const deleteColumnMutation = useMutation({
    mutationFn: ({ nodeId, column }: { nodeId: string; column: string }) =>
      deleteNodeColumn({
        headers: authHeaders,
        path: { workspace_id: ensureWorkspaceSelected(), column_name: column, node_id: nodeId },
        throwOnError: true,
      }).then(({ data }) => data),
    onMutate: () => {
      startOperation('deleteColumn');
    },
    onSuccess: (_data, variables) => {
      invalidateNodeWorkspaceQueries(queryClient, currentWorkspaceId, variables.nodeId, {
        includeData: true,
        includeSchema: true,
      });
      endOperation('deleteColumn');
    },
    onError: (error: Error) => {
      setOperationError('deleteColumn', error.message);
      endOperation('deleteColumn');
    },
  });

  const actions = useMemo(
    () => ({
      filterNode: (nodeId: string, request: FilterRequestPayload) =>
        filterNodeMutation.mutateAsync({ nodeId, request }),
      filterPreview: (nodeId: string, request: FilterRequestPayload, page = 1, pageSize = 10) =>
        filterPreview({
          body: request,
          headers: authHeaders,
          path: { workspace_id: ensureWorkspaceSelected(), node_id: nodeId },
          query: { page, page_size: pageSize },
          throwOnError: true,
        }).then(({ data }) => data),
      sliceNode: (nodeId: string, request: SliceRequest) =>
        sliceNodeMutation.mutateAsync({ nodeId, request }),
      slicePreview: (nodeId: string, request: SliceRequest, page = 1, pageSize = 10) =>
        slicePreview({
          body: request,
          headers: authHeaders,
          path: { workspace_id: ensureWorkspaceSelected(), node_id: nodeId },
          query: { page, page_size: pageSize },
          throwOnError: true,
        }).then(({ data }) => data),
      replaceText: (nodeId: string, request: ReplaceRequest) =>
        replaceTextMutation.mutateAsync({ nodeId, request }),
      replaceTextPreview: (nodeId: string, request: ReplaceRequest, page = 1, pageSize = 10) =>
        replacePreview({
          body: request,
          headers: authHeaders,
          path: { workspace_id: ensureWorkspaceSelected(), node_id: nodeId },
          query: { page, page_size: pageSize },
          throwOnError: true,
        }).then(({ data }) => data),
      polarsExpressionPreview: (
        nodeId: string,
        request: PolarsExpressionRequest,
        page = 1,
        pageSize = 10,
      ) =>
        polarsExpressionPreview({
          body: request,
          headers: authHeaders,
          path: { workspace_id: ensureWorkspaceSelected(), node_id: nodeId },
          query: { page, page_size: pageSize },
          throwOnError: true,
        }).then(({ data }) => data),
      polarsExpressionApply: (nodeId: string, request: PolarsExpressionRequest) =>
        applyPolarsExpression({
          body: request,
          headers: authHeaders,
          path: { workspace_id: ensureWorkspaceSelected(), node_id: nodeId },
          throwOnError: true,
        }).then(({ data }) => data),
      castColumn: (nodeId: string, column: string, targetType: string, format?: string) =>
        castNodeMutation.mutateAsync({ nodeId, column, targetType, format }),
      renameColumn: (nodeId: string, column: string, newName: string) =>
        renameColumnMutation.mutateAsync({ nodeId, column, newName }),
      deleteColumn: (nodeId: string, column: string) =>
        deleteColumnMutation.mutateAsync({ nodeId, column }),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutation refs intentionally omitted; mutateAsync identities are stable
    [authHeaders, currentWorkspaceId, queryClient],
  );

  return { actions } as const;
};
