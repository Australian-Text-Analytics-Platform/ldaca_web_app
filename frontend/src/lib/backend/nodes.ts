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
import type { NodeDataResponse } from '@/types/api';
import type {
  FilterCondition as GeneratedFilterCondition,
  FilterPreviewResponse,
  FilterRequest as GeneratedFilterRequest,
  PolarsExpressionRequest,
  ReplaceRequest,
  SliceRequest,
  TokeniseColumnRequest,
} from '@/api/generated/types.gen';

export type {
  FilterPreviewResponse,
  PolarsExpressionApplyResponse,
  PolarsExpressionContext,
  PolarsExpressionRequest,
  ReplaceApplyResponse,
  ReplaceRequest,
  SliceRequest,
  TokeniseColumnRequest,
  TokeniseColumnResponse,
} from '@/api/generated/types.gen';

export interface ColumnUniqueValuesResponse {
  column_name: string;
  unique_count: number;
  unique_values: Array<string | number | boolean | null>;
  has_null: boolean;
}

export interface ColumnDescribeResponse {
  column_name: string;
  count?: number;
  null_count?: number;
  mean?: number;
  std?: number;
  min?: string | number | null;
  percentile_25?: string | number | null;
  median?: string | number | null;
  percentile_75?: string | number | null;
  max?: string | number | null;
}

export interface QueryPlanResponse {
  plan: string;
}

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

export type FilterCondition = Omit<GeneratedFilterCondition, 'operator'> & {
  operator: FilterOperator;
};

export type FilterRequest = Omit<GeneratedFilterRequest, 'conditions' | 'logic' | 'new_node_name'> & {
  conditions: FilterCondition[];
  logic?: string;
  new_node_name?: string;
};
interface JoinNodesRequest { left_node_id: string; right_node_id: string; left_on: string; right_on: string; how?: string; new_node_name?: string; }
interface JoinPreviewParams { left_node_id: string; right_node_id: string; left_on?: string; right_on?: string; how?: string; }
interface CastNodeRequest { column: string; target_type: string; format?: string; }
interface ConcatPreviewRequest { node_ids: string[]; deduplicate?: boolean; }
interface ConcatRequest extends ConcatPreviewRequest { new_node_name?: string }
// ---------------------------------------------------------------------------
// Column operations registry
// ---------------------------------------------------------------------------

interface OperationInfo {
  method: string;
  label: string;
}

export type ColumnOperationsResponse = {
  operations: Record<string, OperationInfo[]>;
};

export interface DtypeNormalizationChange {
  column: string;
  from_dtype: string;
  to_dtype: string;
  reason: string;
}

export interface NodeInfoResponse {
  id: string;
  name: string;
  operation: string | null;
  parent_ids: string[];
  child_ids: string[];
  document: string | null;
  shape: [number | null, number | null];
  schema: Record<string, string>;
  columns: string[];
  can_undo?: boolean;
  can_redo?: boolean;
  dtype_normalization?: DtypeNormalizationChange[];
}

export interface NodeDataParams {
  page?: number;
  pageSize?: number;
  sortBy?: string | null;
  descending?: boolean;
  filterColumn?: string | null;
  filterValue?: string | null;
  filterOp?: string;
}

export const nodesApi = {
  info: async (node: string, headers: Record<string, string> = {}): Promise<NodeInfoResponse> => {
    const { data } = await getNodeInfoApiWorkspacesNodesNodeIdGet({
      headers,
      path: { node_id: node },
      throwOnError: true,
    });
    return data as NodeInfoResponse;
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
    return data as NodeDataResponse;
  },
  uniqueValues: async (node: string, col: string, headers: Record<string, string> = {}) => {
    const { data } = await getColumnUniqueValuesApiWorkspacesNodesNodeIdColumnsColumnNameUniqueGet({
      headers,
      path: { column_name: col, node_id: node },
      throwOnError: true,
    });
    return data as ColumnUniqueValuesResponse;
  },
  describeColumn: async (node: string, col: string, headers: Record<string, string> = {}) => {
    const { data } = await describeColumnApiWorkspacesNodesNodeIdColumnsColumnNameDescribeGet({
      headers,
      path: { column_name: col, node_id: node },
      throwOnError: true,
    });
    return data as ColumnDescribeResponse;
  },
  delete: async (node: string, headers: Record<string, string> = {}) => {
    const { data } = await deleteNodeApiWorkspacesNodesNodeIdDelete({
      headers,
      path: { node_id: node },
      throwOnError: true,
    });
    return data as Record<string, unknown>;
  },
  rename: async (node: string, newName: string, headers: Record<string, string> = {}) => {
    const { data } = await updateNodeNameApiWorkspacesNodesNodeIdNamePut({
      headers,
      path: { node_id: node },
      query: { new_name: newName },
      throwOnError: true,
    });
    return data as Record<string, unknown>;
  },
  clone: async (node: string, headers: Record<string, string> = {}) => {
    const { data } = await cloneNodeApiWorkspacesNodesNodeIdClonePost({
      headers,
      path: { node_id: node },
      throwOnError: true,
    });
    return data as Record<string, unknown>;
  },
  undo: async (node: string, headers: Record<string, string> = {}) => {
    const { data } = await undoNodeOperationApiWorkspacesNodesNodeIdUndoPost({
      headers,
      path: { node_id: node },
      throwOnError: true,
    });
    return data as NodeInfoResponse;
  },
  redo: async (node: string, headers: Record<string, string> = {}) => {
    const { data } = await redoNodeOperationApiWorkspacesNodesNodeIdRedoPost({
      headers,
      path: { node_id: node },
      throwOnError: true,
    });
    return data as NodeInfoResponse;
  },
  queryPlan: async (node: string, headers: Record<string, string> = {}) => {
    const { data } = await getNodeQueryPlanApiWorkspacesNodesNodeIdQueryPlanGet({
      headers,
      path: { node_id: node },
      throwOnError: true,
    });
    return data as QueryPlanResponse;
  },
  renameColumn: async (node: string, column: string, newName: string, headers: Record<string, string> = {}) => {
    const { data } = await renameNodeColumnApiWorkspacesNodesNodeIdColumnsColumnNamePut({
      body: { new_name: newName },
      headers,
      path: { column_name: column, node_id: node },
      throwOnError: true,
    });
    return data as Record<string, unknown>;
  },
  deleteColumn: async (node: string, column: string, headers: Record<string, string> = {}) => {
    const { data } = await deleteNodeColumnApiWorkspacesNodesNodeIdColumnsColumnNameDelete({
      headers,
      path: { column_name: column, node_id: node },
      throwOnError: true,
    });
    return data as Record<string, unknown>;
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
    return data as NodeInfoResponse;
  },
  join: async (req: JoinNodesRequest, headers: Record<string, string> = {}) => {
    const { data } = await joinNodesApiWorkspacesNodesJoinPost({
      headers,
      query: req,
      throwOnError: true,
    });
    return data as Record<string, unknown>;
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
    return data as FilterPreviewResponse;
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
    return data as FilterPreviewResponse;
  },
  concat: async (req: ConcatRequest, headers: Record<string, string> = {}) => {
    const { data } = await concatNodesApiWorkspacesNodesConcatPost({ body: req, headers, throwOnError: true });
    return data as Record<string, unknown>;
  },
  cast: async (node: string, req: CastNodeRequest, headers: Record<string, string> = {}) => {
    const { data } = await castNodeApiWorkspacesNodesNodeIdCastPost({
      body: req as unknown as Record<string, unknown>,
      headers,
      path: { node_id: node },
      throwOnError: true,
    });
    return data as Record<string, unknown>;
  },
  filter: async (node: string, req: FilterRequest, headers: Record<string, string> = {}): Promise<void> => {
    await filterNodeApiWorkspacesNodesNodeIdFilterPost({
      body: req,
      headers,
      path: { node_id: node },
      throwOnError: true,
    });
  },
  filterPreview: async (node: string, req: FilterRequest, page = 1, pageSize = 10, headers: Record<string, string> = {}) => {
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
    return data as Record<string, unknown>;
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
    return data as ColumnOperationsResponse;
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
