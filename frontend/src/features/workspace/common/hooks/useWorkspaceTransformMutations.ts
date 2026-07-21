import { useMemo } from 'react';
import { type QueryClient, useMutation } from '@tanstack/react-query';
import { createNode, editNode, previewNodeCreationTable, redoNode, undoNode } from '@/api';
import type { CreateNodeData, EditNodeData, PreviewNodeCreationData } from '@/api';
import type { PolarsExpressionRequest } from '@/api';
import type { FilterRequest as FilterRequestPayload } from '@/features/views/preprocessing/types';
import type { SliceRequestPayload } from '@/features/views/preprocessing/slice/hooks/sliceFormModel';
import type { ReplaceRequest } from '@/features/views/preprocessing/replace/hooks/replaceRequestModel';
import type { PreprocessingApplyMode } from '@/features/views/preprocessing/preprocessingApplyMode';
import {
  invalidateNodeWorkspaceQueries,
  invalidateWorkspaceGraphQuery,
} from './workspaceMutationCache';
import { createWorkspaceOperationLifecycle } from './workspaceMutationLifecycle';

interface WorkspaceTransformMutationsParams {
  currentWorkspaceId: string | null;
  queryClient: QueryClient;
  startOperation: (operationId: string) => void;
  endOperation: (operationId: string) => void;
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

const toPreviewResponse = (
  result: Awaited<ReturnType<typeof previewNodeCreationTable>>,
  page: number,
  pageSize: number,
) => ({
  data: result.rows,
  columns: result.columns,
  pagination: { page, page_size: pageSize, has_next: result.hasNext },
});

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
  currentWorkspaceId,
  queryClient,
  startOperation,
  endOperation,
}: WorkspaceTransformMutationsParams) => {
  const requireNode = <T>(value: T | undefined): T => {
    if (value === undefined) throw new Error('Node operation returned no resource');
    return value;
  };
  const ensureWorkspaceSelected = () => {
    if (!currentWorkspaceId) {
      throw new Error('No workspace selected');
    }
    return currentWorkspaceId;
  };
  const operationLifecycle = createWorkspaceOperationLifecycle({
    startOperation,
    endOperation,
  });

  type NodeCreateBody = NonNullable<CreateNodeData['body']>;
  type NodeEditBody = NonNullable<EditNodeData['body']>;
  type NodePreviewBody = NonNullable<PreviewNodeCreationData['body']>;
  const asNodeCreateBody = (body: object) => body as NodeCreateBody;
  const asNodeEditBody = (body: object) => body as NodeEditBody;
  const asNodePreviewBody = (body: object) => body as NodePreviewBody;

  const filterBody = (nodeId: string, request: FilterRequestPayload) =>
    asNodeCreateBody({
      kind: 'filter',
      source_node_id: nodeId,
      conditions: request.conditions,
      logic: request.logic ?? 'and',
      name: request.name,
    });
  const sliceBody = (nodeId: string, request: SliceRequestPayload) =>
    asNodeCreateBody({ kind: 'slice', source_node_id: nodeId, ...request });
  const replaceBody = (nodeId: string, request: ReplaceRequest) =>
    asNodeCreateBody({
      kind: 'replace',
      source_node_id: nodeId,
      source_column: request.source_column,
      pattern: request.pattern,
      replacement: request.replacement,
      output_column: request.output_column,
      mode: request.mode,
      count: request.count,
      match_limit: request.match_limit,
      connector: request.connector,
      name: request.name,
    });
  const expressionBody = (nodeId: string, request: PolarsExpressionRequest) =>
    asNodeCreateBody({
      kind: 'expression',
      source_node_id: nodeId,
      context: request.context,
      expressions: request.expressions,
      group_by: request.group_by,
      name: request.name,
    });
  const filterEditBody = (request: FilterRequestPayload) =>
    asNodeEditBody({
      kind: 'filter',
      conditions: request.conditions,
      logic: request.logic ?? 'and',
    });
  const replaceEditBody = (request: ReplaceRequest) =>
    asNodeEditBody({
      kind: 'replace',
      source_column: request.source_column,
      pattern: request.pattern,
      replacement: request.replacement,
      output_column: request.output_column,
      mode: request.mode,
      count: request.count,
      match_limit: request.match_limit,
      connector: request.connector,
    });
  const expressionEditBody = (request: PolarsExpressionRequest) =>
    asNodeEditBody({
      kind: 'expression',
      context: request.context,
      expressions: request.expressions,
      group_by: request.group_by,
    });

  const invalidateEditedNode = (nodeId: string) => {
    invalidateNodeWorkspaceQueries(queryClient, currentWorkspaceId, nodeId, {
      includeNodeInfo: true,
      includeData: true,
      includeSchema: true,
    });
  };

  const filterNodeMutation = useMutation({
    mutationFn: ({
      nodeId,
      request,
      mode,
    }: {
      nodeId: string;
      request: FilterRequestPayload;
      mode: PreprocessingApplyMode;
    }) =>
      (mode === 'update'
        ? editNode({
            body: filterEditBody(request),
            path: { workspace_id: ensureWorkspaceSelected(), node_id: nodeId },
            throwOnError: true,
          })
        : createNode({
            body: filterBody(nodeId, request),
            path: { workspace_id: ensureWorkspaceSelected() },
            throwOnError: true,
          })
      ).then(({ data }) => {
        requireNode(data);
      }),
    onMutate: operationLifecycle.onMutate('filterNode'),
    onSuccess: operationLifecycle.onSuccess('filterNode', (_response, variables) => {
      if (variables.mode === 'update') {
        invalidateEditedNode(variables.nodeId);
      } else {
        invalidateWorkspaceGraphQuery(queryClient, currentWorkspaceId);
      }
    }),
    onError: operationLifecycle.onError('filterNode'),
  });

  const replaceTextMutation = useMutation({
    mutationFn: ({
      nodeId,
      request,
      mode,
    }: {
      nodeId: string;
      request: ReplaceRequest;
      mode: PreprocessingApplyMode;
    }) =>
      (mode === 'update'
        ? editNode({
            body: replaceEditBody(request),
            path: { workspace_id: ensureWorkspaceSelected(), node_id: nodeId },
            throwOnError: true,
          })
        : createNode({
            body: replaceBody(nodeId, request),
            path: { workspace_id: ensureWorkspaceSelected() },
            throwOnError: true,
          })
      ).then(({ data }) => requireNode(data)),
    onMutate: operationLifecycle.onMutate('replaceText'),
    onSuccess: operationLifecycle.onSuccess('replaceText', (_response, variables) => {
      if (variables.mode === 'update') {
        invalidateEditedNode(variables.nodeId);
      } else {
        invalidateWorkspaceGraphQuery(queryClient, currentWorkspaceId);
      }
    }),
    onError: operationLifecycle.onError('replaceText'),
  });

  const sliceNodeMutation = useMutation({
    mutationFn: ({ nodeId, request }: { nodeId: string; request: SliceRequestPayload }) =>
      createNode({
        body: sliceBody(nodeId, request),
        path: { workspace_id: ensureWorkspaceSelected() },
        throwOnError: true,
      }).then(({ data }) => requireNode(data)),
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
      editNode({
        body: asNodeEditBody({
          kind: 'cast',
          column,
          target_type: targetType,
          datetime_format: format,
        }),
        path: { workspace_id: ensureWorkspaceSelected(), node_id: nodeId },
        throwOnError: true,
      }).then(({ data }) => requireNode(data)),
    onMutate: operationLifecycle.onMutate('castNode'),
    onSuccess: operationLifecycle.onSuccess('castNode', (_data, variables) => {
      invalidateEditedNode(variables.nodeId);
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
      editNode({
        body: { kind: 'rename_column', column, new_name: newName },
        path: { workspace_id: ensureWorkspaceSelected(), node_id: nodeId },
        throwOnError: true,
      }).then(({ data }) => requireNode(data)),
    onMutate: operationLifecycle.onMutate('renameColumn'),
    onSuccess: operationLifecycle.onSuccess('renameColumn', (_response, variables) => {
      invalidateEditedNode(variables.nodeId);
    }),
    onError: operationLifecycle.onError('renameColumn'),
  });

  const deleteColumnMutation = useMutation({
    mutationFn: ({ nodeId, column }: { nodeId: string; column: string }) =>
      editNode({
        body: { kind: 'delete_column', column },
        path: { workspace_id: ensureWorkspaceSelected(), node_id: nodeId },
        throwOnError: true,
      }).then(({ data }) => requireNode(data)),
    onMutate: operationLifecycle.onMutate('deleteColumn'),
    onSuccess: operationLifecycle.onSuccess('deleteColumn', (_response, variables) => {
      invalidateEditedNode(variables.nodeId);
    }),
    onError: operationLifecycle.onError('deleteColumn'),
  });

  const expressionMutation = useMutation({
    mutationFn: ({
      nodeId,
      request,
      mode,
    }: {
      nodeId: string;
      request: PolarsExpressionRequest;
      mode: PreprocessingApplyMode;
    }) =>
      (mode === 'update'
        ? editNode({
            body: expressionEditBody(request),
            path: { workspace_id: ensureWorkspaceSelected(), node_id: nodeId },
            throwOnError: true,
          })
        : createNode({
            body: expressionBody(nodeId, request),
            path: { workspace_id: ensureWorkspaceSelected() },
            throwOnError: true,
          })
      ).then(({ data }) => requireNode(data)),
    onMutate: operationLifecycle.onMutate('polarsExpressionApply'),
    onSuccess: operationLifecycle.onSuccess('polarsExpressionApply', (_response, variables) => {
      if (variables.mode === 'update') {
        invalidateEditedNode(variables.nodeId);
      } else {
        invalidateWorkspaceGraphQuery(queryClient, currentWorkspaceId);
      }
    }),
    onError: operationLifecycle.onError('polarsExpressionApply'),
  });

  const undoNodeMutation = useMutation({
    mutationFn: (nodeId: string) =>
      undoNode({
        path: { workspace_id: ensureWorkspaceSelected(), node_id: nodeId },
        throwOnError: true,
      }).then(({ data }) => requireNode(data)),
    onMutate: operationLifecycle.onMutate('undoNode'),
    onSuccess: operationLifecycle.onSuccess('undoNode', (_response, nodeId) => {
      invalidateEditedNode(nodeId);
    }),
    onError: operationLifecycle.onError('undoNode'),
  });

  const redoNodeMutation = useMutation({
    mutationFn: (nodeId: string) =>
      redoNode({
        path: { workspace_id: ensureWorkspaceSelected(), node_id: nodeId },
        throwOnError: true,
      }).then(({ data }) => requireNode(data)),
    onMutate: operationLifecycle.onMutate('redoNode'),
    onSuccess: operationLifecycle.onSuccess('redoNode', (_response, nodeId) => {
      invalidateEditedNode(nodeId);
    }),
    onError: operationLifecycle.onError('redoNode'),
  });

  const actions = useMemo(
    () => ({
      filterNode: (
        nodeId: string,
        request: FilterRequestPayload,
        mode: PreprocessingApplyMode = 'create',
      ) => filterNodeMutation.mutateAsync({ nodeId, request, mode }),
      filterPreview: ({
        workspaceId,
        nodeId,
        payload,
        page,
        pageSize,
        signal,
      }: WorkspaceOperationPreviewRequest<FilterRequestPayload>) =>
        previewNodeCreationTable({
          body: asNodePreviewBody(filterBody(nodeId, payload)),
          path: { workspace_id: workspaceId },
          query: { page, page_size: pageSize },
          signal,
        }).then((result) => toPreviewResponse(result, page, pageSize)),
      sliceNode: (nodeId: string, request: SliceRequestPayload) =>
        sliceNodeMutation.mutateAsync({ nodeId, request }),
      slicePreview: ({
        workspaceId,
        nodeId,
        payload,
        page,
        pageSize,
        signal,
      }: WorkspaceOperationPreviewRequest<SliceRequestPayload>) =>
        previewNodeCreationTable({
          body: asNodePreviewBody(sliceBody(nodeId, payload)),
          path: { workspace_id: workspaceId },
          query: { page, page_size: pageSize },
          signal,
        }).then((result) => toPreviewResponse(result, page, pageSize)),
      replaceText: (
        nodeId: string,
        request: ReplaceRequest,
        mode: PreprocessingApplyMode = 'create',
      ) => replaceTextMutation.mutateAsync({ nodeId, request, mode }),
      replaceTextPreview: ({
        workspaceId,
        nodeId,
        payload,
        page,
        pageSize,
        signal,
      }: WorkspaceOperationPreviewRequest<ReplaceRequest>) =>
        previewNodeCreationTable({
          body: asNodePreviewBody(replaceBody(nodeId, payload)),
          path: { workspace_id: workspaceId },
          query: { page, page_size: pageSize },
          signal,
        }).then((result) => toPreviewResponse(result, page, pageSize)),
      polarsExpressionPreview: ({
        workspaceId,
        nodeId,
        payload,
        page,
        pageSize,
        signal,
      }: WorkspaceOperationPreviewRequest<PolarsExpressionRequest>) =>
        previewNodeCreationTable({
          body: asNodePreviewBody(expressionBody(nodeId, payload)),
          path: { workspace_id: workspaceId },
          query: { page, page_size: pageSize },
          signal,
        }).then((result) => toPreviewResponse(result, page, pageSize)),
      polarsExpressionApply: (
        nodeId: string,
        request: PolarsExpressionRequest,
        mode: PreprocessingApplyMode = 'create',
      ) => expressionMutation.mutateAsync({ nodeId, request, mode }),
      castColumn: (nodeId: string, column: string, targetType: string, format?: string) =>
        castNodeMutation.mutateAsync({ nodeId, column, targetType, format }),
      renameColumn: (nodeId: string, column: string, newName: string) =>
        renameColumnMutation.mutateAsync({ nodeId, column, newName }),
      deleteColumn: (nodeId: string, column: string) =>
        deleteColumnMutation.mutateAsync({ nodeId, column }),
      undoNode: (nodeId: string) => undoNodeMutation.mutateAsync(nodeId),
      redoNode: (nodeId: string) => redoNodeMutation.mutateAsync(nodeId),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutation refs intentionally omitted; mutateAsync identities are stable
    [currentWorkspaceId, queryClient],
  );

  return { actions } as const;
};
