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
import { createWorkspaceOperationLifecycle } from './workspaceMutationLifecycle';

interface WorkspaceTransformMutationsParams {
  authHeaders: Record<string, string>;
  currentWorkspaceId: string | null;
  queryClient: QueryClient;
  startOperation: (operationId: string) => void;
  endOperation: (operationId: string) => void;
  setOperationError: (operationId: string, error: string) => void;
}

/** Complete identity and transport context for one cancellable preprocessing preview. */
interface WorkspaceOperationPreviewRequest<RequestPayload> {
  workspaceId: string;
  nodeId: string;
  payload: RequestPayload;
  page: number;
  pageSize: number;
  signal: AbortSignal;
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
  const operationLifecycle = createWorkspaceOperationLifecycle({
    startOperation,
    endOperation,
    setOperationError,
  });

  const filterNodeMutation = useMutation({
    mutationFn: ({ nodeId, request }: { nodeId: string; request: FilterRequestPayload }) =>
      applyFilterNode({
        body: request,
        headers: authHeaders,
        path: { workspace_id: ensureWorkspaceSelected(), node_id: nodeId },
        throwOnError: true,
      }).then(() => undefined),
    onMutate: operationLifecycle.onMutate('filterNode'),
    onSuccess: operationLifecycle.onSuccess('filterNode', () => {
      invalidateWorkspaceGraphQuery(queryClient, currentWorkspaceId);
    }),
    onError: operationLifecycle.onError('filterNode'),
  });

  const replaceTextMutation = useMutation({
    mutationFn: ({ nodeId, request }: { nodeId: string; request: ReplaceRequest }) =>
      replaceApply({
        body: request,
        headers: authHeaders,
        path: { workspace_id: ensureWorkspaceSelected(), node_id: nodeId },
        throwOnError: true,
      }).then(({ data }) => data),
    onMutate: operationLifecycle.onMutate('replaceText'),
    onSuccess: operationLifecycle.onSuccess('replaceText', (_response, variables) => {
      invalidateNodeWorkspaceQueries(queryClient, currentWorkspaceId, variables.nodeId, {
        includeData: true,
        includeSchema: true,
      });
    }),
    onError: operationLifecycle.onError('replaceText'),
  });

  const sliceNodeMutation = useMutation({
    mutationFn: ({ nodeId, request }: { nodeId: string; request: SliceRequest }) =>
      applySliceNode({
        body: request,
        headers: authHeaders,
        path: { workspace_id: ensureWorkspaceSelected(), node_id: nodeId },
        throwOnError: true,
      }).then(({ data }) => data),
    onMutate: operationLifecycle.onMutate('sliceNode'),
    onSuccess: operationLifecycle.onSuccess('sliceNode', () => {
      invalidateWorkspaceGraphQuery(queryClient, currentWorkspaceId);
    }),
    onError: operationLifecycle.onError('sliceNode'),
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
    onMutate: operationLifecycle.onMutate('castNode'),
    onSuccess: operationLifecycle.onSuccess('castNode', (_data, variables) => {
      invalidateNodeWorkspaceQueries(queryClient, currentWorkspaceId, variables.nodeId, {
        includeNodeInfo: true,
        includeData: true,
        includeSchema: true,
      });
    }),
    onError: operationLifecycle.onError('castNode'),
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
    onMutate: operationLifecycle.onMutate('renameColumn'),
    onSuccess: operationLifecycle.onSuccess('renameColumn', (_data, variables) => {
      invalidateNodeWorkspaceQueries(queryClient, currentWorkspaceId, variables.nodeId, {
        includeData: true,
        includeSchema: true,
      });
    }),
    onError: operationLifecycle.onError('renameColumn'),
  });

  const deleteColumnMutation = useMutation({
    mutationFn: ({ nodeId, column }: { nodeId: string; column: string }) =>
      deleteNodeColumn({
        headers: authHeaders,
        path: { workspace_id: ensureWorkspaceSelected(), column_name: column, node_id: nodeId },
        throwOnError: true,
      }).then(({ data }) => data),
    onMutate: operationLifecycle.onMutate('deleteColumn'),
    onSuccess: operationLifecycle.onSuccess('deleteColumn', (_data, variables) => {
      invalidateNodeWorkspaceQueries(queryClient, currentWorkspaceId, variables.nodeId, {
        includeData: true,
        includeSchema: true,
      });
    }),
    onError: operationLifecycle.onError('deleteColumn'),
  });

  const actions = useMemo(
    () => ({
      filterNode: (nodeId: string, request: FilterRequestPayload) =>
        filterNodeMutation.mutateAsync({ nodeId, request }),
      filterPreview: ({
        workspaceId,
        nodeId,
        payload,
        page,
        pageSize,
        signal,
      }: WorkspaceOperationPreviewRequest<FilterRequestPayload>) =>
        filterPreview({
          body: payload,
          headers: authHeaders,
          path: { workspace_id: workspaceId, node_id: nodeId },
          query: { page, page_size: pageSize },
          signal,
          throwOnError: true,
        }).then(({ data }) => data),
      sliceNode: (nodeId: string, request: SliceRequest) =>
        sliceNodeMutation.mutateAsync({ nodeId, request }),
      slicePreview: ({
        workspaceId,
        nodeId,
        payload,
        page,
        pageSize,
        signal,
      }: WorkspaceOperationPreviewRequest<SliceRequest>) =>
        slicePreview({
          body: payload,
          headers: authHeaders,
          path: { workspace_id: workspaceId, node_id: nodeId },
          query: { page, page_size: pageSize },
          signal,
          throwOnError: true,
        }).then(({ data }) => data),
      replaceText: (nodeId: string, request: ReplaceRequest) =>
        replaceTextMutation.mutateAsync({ nodeId, request }),
      replaceTextPreview: ({
        workspaceId,
        nodeId,
        payload,
        page,
        pageSize,
        signal,
      }: WorkspaceOperationPreviewRequest<ReplaceRequest>) =>
        replacePreview({
          body: payload,
          headers: authHeaders,
          path: { workspace_id: workspaceId, node_id: nodeId },
          query: { page, page_size: pageSize },
          signal,
          throwOnError: true,
        }).then(({ data }) => data),
      polarsExpressionPreview: ({
        workspaceId,
        nodeId,
        payload,
        page,
        pageSize,
        signal,
      }: WorkspaceOperationPreviewRequest<PolarsExpressionRequest>) =>
        polarsExpressionPreview({
          body: payload,
          headers: authHeaders,
          path: { workspace_id: workspaceId, node_id: nodeId },
          query: { page, page_size: pageSize },
          signal,
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
