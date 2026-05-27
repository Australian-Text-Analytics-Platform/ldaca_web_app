import {
  addNodeToWorkspaceApiWorkspacesNodesPost,
  castNodeApiWorkspacesNodesNodeIdCastPost,
  cloneNodeApiWorkspacesNodesNodeIdClonePost,
  columnOperationsApiWorkspacesNodesNodeIdColumnsColumnNameOperationsGet,
  concatNodesApiWorkspacesNodesConcatPost,
  concatNodesPreviewApiWorkspacesNodesConcatPreviewPost,
  deleteNodeApiWorkspacesNodesNodeIdDelete,
  deleteNodeColumnApiWorkspacesNodesNodeIdColumnsColumnNameDelete,
  describeColumnApiWorkspacesNodesNodeIdColumnsColumnNameDescribeGet,
  filterNodeApiWorkspacesNodesNodeIdFilterPost,
  filterPreviewApiWorkspacesNodesNodeIdFilterPreviewPost,
  getColumnUniqueValuesApiWorkspacesNodesNodeIdColumnsColumnNameUniqueGet,
  getNodeDataApiWorkspacesNodesNodeIdDataGet,
  getNodeInfoApiWorkspacesNodesNodeIdGet,
  getNodeQueryPlanApiWorkspacesNodesNodeIdQueryPlanGet,
  joinNodesApiWorkspacesNodesJoinPost,
  joinNodesPreviewApiWorkspacesNodesJoinPreviewPost,
  polarsExpressionApplyApiWorkspacesNodesNodeIdExpressionApplyPost,
  polarsExpressionPreviewApiWorkspacesNodesNodeIdExpressionPreviewPost,
  redoNodeOperationApiWorkspacesNodesNodeIdRedoPost,
  renameNodeColumnApiWorkspacesNodesNodeIdColumnsColumnNamePut,
  replaceApplyApiWorkspacesNodesNodeIdReplacePost,
  replacePreviewApiWorkspacesNodesNodeIdReplacePreviewPost,
  sliceNodeApiWorkspacesNodesNodeIdSlicePost,
  slicePreviewApiWorkspacesNodesNodeIdSlicePreviewPost,
  undoNodeOperationApiWorkspacesNodesNodeIdUndoPost,
  updateNodeNameApiWorkspacesNodesNodeIdNamePut,
  createTokenizationApiWorkspacesNodesNodeIdTokenizationPost,
} from '@/api/generated/sdk.gen';
import type {
  CastNodeRequest,
  ConcatPreviewRequest,
  ConcatRequest,
  FilterCondition as GeneratedFilterCondition,
  FilterRequest as GeneratedFilterRequest,
  JoinNodesApiWorkspacesNodesJoinPostData,
  JoinNodesPreviewApiWorkspacesNodesJoinPreviewPostData,
  PolarsExpressionRequest,
  ReplaceRequest,
  SliceRequest,
  TokeniseColumnRequest,
  WorkspaceNodeInfo as NodeInfoResponse,
} from '@/api/generated/types.gen';

export type {
  ColumnDescribeResponse,
  ColumnOperationsResponse,
  ColumnUniqueValuesResponse,
  DtypeNormalizationChange,
  FilterPreviewResponse,
  NodeDataResponse,
  NodeQueryPlanResponse as QueryPlanResponse,
  WorkspaceNodeInfo as NodeInfoResponse,
  PolarsExpressionApplyResponse,
  PolarsExpressionContext,
  PolarsExpressionRequest,
  ReplaceApplyResponse,
  ReplaceRequest,
  SliceRequest,
  TokeniseColumnRequest,
  TokeniseColumnResponse,
} from '@/api/generated/types.gen';

export type FilterOperator =
  | 'eq'
  | 'gte'
  | 'lte'
  | 'contains'
  | 'startswith'
  | 'endswith'
  | 'is_null'
  | 'between'
  | 'in';

export type FilterConditionPayload = Omit<GeneratedFilterCondition, 'operator'> & {
  operator: FilterOperator;
};

export type FilterRequestPayload = Omit<GeneratedFilterRequest, 'conditions' | 'logic' | 'new_node_name'> & {
  conditions: FilterConditionPayload[];
  logic?: string;
  new_node_name?: string;
};
type JoinNodesRequest = JoinNodesApiWorkspacesNodesJoinPostData['query'];
type JoinPreviewParams = Omit<JoinNodesPreviewApiWorkspacesNodesJoinPreviewPostData['query'], 'page' | 'page_size'>;
export type NodeDataParams = {
  page?: number;
  pageSize?: number;
  sortBy?: string | null;
  descending?: boolean;
  filterColumn?: string | null;
  filterValue?: string | null;
  filterOp?: string;
};

export const nodesApi = {
  info: async (node: string, headers: Record<string, string> = {}): Promise<NodeInfoResponse> => {
    const { data } = await getNodeInfoApiWorkspacesNodesNodeIdGet({
      headers,
      path: { node_id: node },
      throwOnError: true,
    });
    return data;
  },
  data: async (node: string, params: NodeDataParams = {}, headers: Record<string, string> = {}) => {
    const query = {
      page: params.page ?? 1,
      page_size: params.pageSize ?? 20,
      descending: params.descending ?? false,
      filter_column: params.filterColumn ?? undefined,
      filter_op: params.filterOp ?? 'contains',
      filter_value: params.filterValue ?? undefined,
      sort_by: params.sortBy ?? undefined,
    };
    const { data } = await getNodeDataApiWorkspacesNodesNodeIdDataGet({
      headers,
      path: { node_id: node },
      query,
      throwOnError: true,
    });
    return data;
  },
  uniqueValues: async (node: string, col: string, headers: Record<string, string> = {}) => {
    const { data } = await getColumnUniqueValuesApiWorkspacesNodesNodeIdColumnsColumnNameUniqueGet({
      headers,
      path: { column_name: col, node_id: node },
      throwOnError: true,
    });
    return data;
  },
  describeColumn: async (node: string, col: string, headers: Record<string, string> = {}) => {
    const { data } = await describeColumnApiWorkspacesNodesNodeIdColumnsColumnNameDescribeGet({
      headers,
      path: { column_name: col, node_id: node },
      throwOnError: true,
    });
    return data;
  },
  delete: async (node: string, headers: Record<string, string> = {}) => {
    const { data } = await deleteNodeApiWorkspacesNodesNodeIdDelete({
      headers,
      path: { node_id: node },
      throwOnError: true,
    });
    return data;
  },
  rename: async (node: string, newName: string, headers: Record<string, string> = {}) => {
    const { data } = await updateNodeNameApiWorkspacesNodesNodeIdNamePut({
      headers,
      path: { node_id: node },
      query: { new_name: newName },
      throwOnError: true,
    });
    return data;
  },
  clone: async (node: string, headers: Record<string, string> = {}) => {
    const { data } = await cloneNodeApiWorkspacesNodesNodeIdClonePost({
      headers,
      path: { node_id: node },
      throwOnError: true,
    });
    return data;
  },
  undo: async (node: string, headers: Record<string, string> = {}) => {
    const { data } = await undoNodeOperationApiWorkspacesNodesNodeIdUndoPost({
      headers,
      path: { node_id: node },
      throwOnError: true,
    });
    return data;
  },
  redo: async (node: string, headers: Record<string, string> = {}) => {
    const { data } = await redoNodeOperationApiWorkspacesNodesNodeIdRedoPost({
      headers,
      path: { node_id: node },
      throwOnError: true,
    });
    return data;
  },
  queryPlan: async (node: string, headers: Record<string, string> = {}) => {
    const { data } = await getNodeQueryPlanApiWorkspacesNodesNodeIdQueryPlanGet({
      headers,
      path: { node_id: node },
      throwOnError: true,
    });
    return data;
  },
  renameColumn: async (node: string, column: string, newName: string, headers: Record<string, string> = {}) => {
    const { data } = await renameNodeColumnApiWorkspacesNodesNodeIdColumnsColumnNamePut({
      body: { new_name: newName },
      headers,
      path: { column_name: column, node_id: node },
      throwOnError: true,
    });
    return data;
  },
  deleteColumn: async (node: string, column: string, headers: Record<string, string> = {}) => {
    const { data } = await deleteNodeColumnApiWorkspacesNodesNodeIdColumnsColumnNameDelete({
      headers,
      path: { column_name: column, node_id: node },
      throwOnError: true,
    });
    return data;
  },
  createFromFile: async (
    filename: string,
    _nodeName?: string,
    headers: Record<string, string> = {},
    sheetName?: string,
  ) => {
    const { data } = await addNodeToWorkspaceApiWorkspacesNodesPost({
      headers,
      query: {
        filename,
        mode: 'LazyFrame',
        ...(sheetName ? { sheet_name: sheetName } : {}),
      },
      throwOnError: true,
    });
    return data;
  },
  join: async (req: JoinNodesRequest, headers: Record<string, string> = {}) => {
    const { data } = await joinNodesApiWorkspacesNodesJoinPost({
      headers,
      query: req,
      throwOnError: true,
    });
    return data;
  },
  joinPreview: async (
    req: JoinPreviewParams,
    page = 1,
    pageSize = 10,
    headers: Record<string, string> = {},
  ) => {
    const { data } = await joinNodesPreviewApiWorkspacesNodesJoinPreviewPost({
      headers,
      query: {
        ...req,
        how: req.how ?? 'inner',
        page,
        page_size: pageSize,
      },
      throwOnError: true,
    });
    return data;
  },
  concatPreview: async (
    req: ConcatPreviewRequest,
    page = 1,
    pageSize = 10,
    headers: Record<string, string> = {},
  ) => {
    const { data } = await concatNodesPreviewApiWorkspacesNodesConcatPreviewPost({
      body: req,
      headers,
      query: { page, page_size: pageSize },
      throwOnError: true,
    });
    return data;
  },
  concat: async (req: ConcatRequest, headers: Record<string, string> = {}) => {
    const { data } = await concatNodesApiWorkspacesNodesConcatPost({ body: req, headers, throwOnError: true });
    return data;
  },
  cast: async (node: string, req: CastNodeRequest, headers: Record<string, string> = {}) => {
    const { data } = await castNodeApiWorkspacesNodesNodeIdCastPost({
      body: req,
      headers,
      path: { node_id: node },
      throwOnError: true,
    });
    return data;
  },
  filter: async (node: string, req: FilterRequestPayload, headers: Record<string, string> = {}): Promise<void> => {
    await filterNodeApiWorkspacesNodesNodeIdFilterPost({
      body: req,
      headers,
      path: { node_id: node },
      throwOnError: true,
    });
  },
  filterPreview: async (node: string, req: FilterRequestPayload, page = 1, pageSize = 10, headers: Record<string, string> = {}) => {
    const { data } = await filterPreviewApiWorkspacesNodesNodeIdFilterPreviewPost({
      body: req,
      headers,
      path: { node_id: node },
      query: { page, page_size: pageSize },
      throwOnError: true,
    });
    return data;
  },
  slicePreview: async (node: string, req: SliceRequest, page = 1, pageSize = 10, headers: Record<string, string> = {}) => {
    const { data } = await slicePreviewApiWorkspacesNodesNodeIdSlicePreviewPost({
      body: req,
      headers,
      path: { node_id: node },
      query: { page, page_size: pageSize },
      throwOnError: true,
    });
    return data;
  },
  slice: async (node: string, req: SliceRequest, headers: Record<string, string> = {}) => {
    const { data } = await sliceNodeApiWorkspacesNodesNodeIdSlicePost({
      body: req,
      headers,
      path: { node_id: node },
      throwOnError: true,
    });
    return data;
  },
  columnOperations: async (
    node: string,
    column: string,
    headers: Record<string, string> = {}
  ) => {
    const { data } = await columnOperationsApiWorkspacesNodesNodeIdColumnsColumnNameOperationsGet({
      headers,
      path: { column_name: column, node_id: node },
      throwOnError: true,
    });
    return data;
  },
  replaceTextPreview: async (
    node: string,
    req: ReplaceRequest,
    page = 1,
    pageSize = 10,
    headers: Record<string, string> = {}
  ) => {
    const { data } = await replacePreviewApiWorkspacesNodesNodeIdReplacePreviewPost({
      body: req,
      headers,
      path: { node_id: node },
      query: { page, page_size: pageSize },
      throwOnError: true,
    });
    return data;
  },
  replaceText: async (
    node: string,
    req: ReplaceRequest,
    headers: Record<string, string> = {}
  ) => {
    const { data } = await replaceApplyApiWorkspacesNodesNodeIdReplacePost({
      body: req,
      headers,
      path: { node_id: node },
      throwOnError: true,
    });
    return data;
  },
  polarsExpressionPreview: async (
    node: string,
    req: PolarsExpressionRequest,
    page = 1,
    pageSize = 10,
    headers: Record<string, string> = {}
  ) => {
    const { data } = await polarsExpressionPreviewApiWorkspacesNodesNodeIdExpressionPreviewPost({
      body: req,
      headers,
      path: { node_id: node },
      query: { page, page_size: pageSize },
      throwOnError: true,
    });
    return data;
  },
  polarsExpressionApply: async (
    node: string,
    req: PolarsExpressionRequest,
    headers: Record<string, string> = {}
  ) => {
    const { data } = await polarsExpressionApplyApiWorkspacesNodesNodeIdExpressionApplyPost({
      body: req,
      headers,
      path: { node_id: node },
      throwOnError: true,
    });
    return data;
  },

  tokeniseColumn: async (
    node: string,
    req: TokeniseColumnRequest,
    headers: Record<string, string> = {},
  ) => {
    const { data } = await createTokenizationApiWorkspacesNodesNodeIdTokenizationPost({
      body: req,
      headers,
      path: { node_id: node },
      throwOnError: true,
    });
    return data;
  },

};
