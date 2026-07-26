import { useMemo } from 'react';
import { type QueryClient, useMutation } from '@tanstack/react-query';
import {
  createNode,
  createWorkspaceSqlDataBlock,
  editNode,
  previewNodeCreationTable,
  redoNode,
  undoNode,
} from '@/api';
import type {
  AnnotationClassRow,
  CreateNodeData,
  EditNodeData,
  PreviewNodeCreationData,
} from '@/api';
import type { PolarsExpressionRequest } from '@/api';
import type { FilterRequest as FilterRequestPayload } from '@/features/views/preprocessing/types';
import type { SliceRequestPayload } from '@/features/views/preprocessing/slice/hooks/sliceFormModel';
import type { ReplaceRequest } from '@/features/views/preprocessing/replace/hooks/replaceRequestModel';
import type { PreprocessingApplyMode } from '@/features/views/preprocessing/preprocessingApplyMode';
import {
  invalidateNodeWorkspaceQueries,
  invalidateWorkspaceGraphQuery,
} from './workspaceMutationCache';

interface WorkspaceTransformMutationsParams {
  currentWorkspaceId: string | null;
  queryClient: QueryClient;
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
  type NodeCreateBody = NonNullable<CreateNodeData['body']>;
  type NodeEditBody = NonNullable<EditNodeData['body']>;
  type NodePreviewBody = NonNullable<PreviewNodeCreationData['body']>;
  type ExpressionNodeCreateBody = Extract<NodeCreateBody, { kind: 'expression' }>;
  type ExpressionNodeEditBody = Extract<NodeEditBody, { kind: 'expression' }>;
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
  const expressionBody = (
    nodeId: string,
    request: PolarsExpressionRequest,
  ): ExpressionNodeCreateBody => ({
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
  const expressionEditBody = (request: PolarsExpressionRequest): ExpressionNodeEditBody => ({
    kind: 'expression',
    context: request.context,
    expressions: request.expressions,
    group_by: request.group_by,
  });

  const invalidateEditedNode = (nodeId: string) => {
    invalidateNodeWorkspaceQueries(queryClient, currentWorkspaceId, nodeId, {
      includeData: true,
      includeSchema: true,
    });
  };

  const filterNodeMutation = useMutation({
    mutationKey: ['workspace', 'filter-node'],
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
    onSuccess: (_response, variables) => {
      if (variables.mode === 'update') {
        invalidateEditedNode(variables.nodeId);
      } else {
        invalidateWorkspaceGraphQuery(queryClient, currentWorkspaceId);
      }
    },
  });

  const replaceTextMutation = useMutation({
    mutationKey: ['workspace', 'replace-text'],
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
    onSuccess: (_response, variables) => {
      if (variables.mode === 'update') {
        invalidateEditedNode(variables.nodeId);
      } else {
        invalidateWorkspaceGraphQuery(queryClient, currentWorkspaceId);
      }
    },
  });

  const sliceNodeMutation = useMutation({
    mutationKey: ['workspace', 'slice-node'],
    mutationFn: ({ nodeId, request }: { nodeId: string; request: SliceRequestPayload }) =>
      createNode({
        body: sliceBody(nodeId, request),
        path: { workspace_id: ensureWorkspaceSelected() },
        throwOnError: true,
      }).then(({ data }) => requireNode(data)),
    onSuccess: () => {
      invalidateWorkspaceGraphQuery(queryClient, currentWorkspaceId);
    },
  });

  const castNodeMutation = useMutation({
    mutationKey: ['workspace', 'cast-node'],
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
    onSuccess: (_data, variables) => {
      invalidateEditedNode(variables.nodeId);
    },
  });

  const renameColumnMutation = useMutation({
    mutationKey: ['workspace', 'rename-column'],
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
    onSuccess: (_response, variables) => {
      invalidateEditedNode(variables.nodeId);
    },
  });

  const deleteColumnMutation = useMutation({
    mutationKey: ['workspace', 'delete-column'],
    mutationFn: ({ nodeId, column }: { nodeId: string; column: string }) =>
      editNode({
        body: { kind: 'delete_column', column },
        path: { workspace_id: ensureWorkspaceSelected(), node_id: nodeId },
        throwOnError: true,
      }).then(({ data }) => requireNode(data)),
    onSuccess: (_response, variables) => {
      invalidateEditedNode(variables.nodeId);
    },
  });

  const expressionMutation = useMutation({
    mutationKey: ['workspace', 'expression'],
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
    onSuccess: (_response, variables) => {
      if (variables.mode === 'update') {
        invalidateEditedNode(variables.nodeId);
      } else {
        invalidateWorkspaceGraphQuery(queryClient, currentWorkspaceId);
      }
    },
  });

  const undoNodeMutation = useMutation({
    mutationKey: ['workspace', 'undo-node'],
    mutationFn: (nodeId: string) =>
      undoNode({
        path: { workspace_id: ensureWorkspaceSelected(), node_id: nodeId },
        throwOnError: true,
      }).then(({ data }) => requireNode(data)),
    onSuccess: (_response, nodeId) => {
      invalidateEditedNode(nodeId);
    },
  });

  const redoNodeMutation = useMutation({
    mutationKey: ['workspace', 'redo-node'],
    mutationFn: (nodeId: string) =>
      redoNode({
        path: { workspace_id: ensureWorkspaceSelected(), node_id: nodeId },
        throwOnError: true,
      }).then(({ data }) => requireNode(data)),
    onSuccess: (_response, nodeId) => {
      invalidateEditedNode(nodeId);
    },
  });

  const setCellMutation = useMutation({
    mutationKey: ['workspace', 'set-cell'],
    mutationFn: ({
      nodeId,
      column,
      rowIndex,
      value,
    }: {
      nodeId: string;
      column: string;
      rowIndex: number;
      value: string | null;
    }) =>
      editNode({
        body: { kind: 'set_cell', column, row_index: rowIndex, value },
        path: { workspace_id: ensureWorkspaceSelected(), node_id: nodeId },
        throwOnError: true,
      }).then(({ data }) => requireNode(data)),
    onSuccess: (_response, variables) => {
      invalidateEditedNode(variables.nodeId);
    },
  });

  const annotationClassesMutation = useMutation({
    mutationKey: ['workspace', 'annotation-classes'],
    mutationFn: ({
      nodeId,
      classColumn,
      descriptionColumn,
      rows,
    }: {
      nodeId: string;
      classColumn: string;
      descriptionColumn: string;
      rows: AnnotationClassRow[];
    }) =>
      editNode({
        body: {
          kind: 'annotation_classes',
          class_column: classColumn,
          description_column: descriptionColumn,
          rows,
        },
        path: { workspace_id: ensureWorkspaceSelected(), node_id: nodeId },
        throwOnError: true,
      }).then(({ data }) => requireNode(data)),
    onSuccess: (_response, variables) => {
      invalidateEditedNode(variables.nodeId);
    },
  });

  const createSqlDataBlockMutation = useMutation({
    mutationKey: ['workspace', 'create-sql-data-block'],
    mutationFn: ({ nodeIds, sql, name }: { nodeIds: string[]; sql: string; name: string }) =>
      createWorkspaceSqlDataBlock({
        path: { workspace_id: ensureWorkspaceSelected() },
        body: { mode: 'create', node_ids: nodeIds, sql, name },
      }),
    onSuccess: () => {
      invalidateWorkspaceGraphQuery(queryClient, currentWorkspaceId);
    },
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
      setCell: (nodeId: string, column: string, rowIndex: number, value: string | null) =>
        setCellMutation.mutateAsync({ nodeId, column, rowIndex, value }),
      saveAnnotationClasses: (
        nodeId: string,
        classColumn: string,
        descriptionColumn: string,
        rows: AnnotationClassRow[],
      ) =>
        annotationClassesMutation.mutateAsync({
          nodeId,
          classColumn,
          descriptionColumn,
          rows,
        }),
      createSqlDataBlock: (nodeIds: string[], sql: string, name: string) =>
        createSqlDataBlockMutation.mutateAsync({ nodeIds, sql, name }),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutation refs intentionally omitted; mutateAsync identities are stable
    [currentWorkspaceId, queryClient],
  );

  return { actions } as const;
};
