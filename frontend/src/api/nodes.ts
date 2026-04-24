import { get, post, del, httpRequest } from './http';
import type { NodeDataResponse } from '../types/api';

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

export interface FilterCondition {
  column: string;
  operator: 'eq' | 'gte' | 'lte' | 'contains' | 'startswith' | 'endswith' | 'is_null' | 'between' | 'in';
  value: unknown;
  negate?: boolean;
  regex?: boolean;
  case_sensitive?: boolean;
}
export interface FilterRequest { conditions: FilterCondition[]; logic?: string; new_node_name?: string; }
export interface SliceRequest {
  mode?: 'slice' | 'random_sample';
  offset?: number;
  length?: number;
  sample_size?: number;
  random_seed?: number;
  new_node_name?: string;
}
export interface JoinNodesRequest { left_node_id: string; right_node_id: string; left_on: string; right_on: string; how?: string; new_node_name?: string; }
export interface JoinPreviewParams { left_node_id: string; right_node_id: string; left_on?: string; right_on?: string; how?: string; }
export interface CastNodeRequest { column: string; target_type: string; format?: string; }
export interface ConcatPreviewRequest { node_ids: string[]; }
export interface ConcatRequest extends ConcatPreviewRequest { new_node_name?: string }
export interface FilterPreviewResponse {
  data: Record<string, unknown>[];
  columns: string[];
  dtypes: Record<string, string>;
  pagination: {
    page: number;
    page_size: number;
    total_rows: number;
    total_pages: number;
    has_next: boolean;
    has_prev: boolean;
  };
}
export type JoinPreviewResponse = FilterPreviewResponse;

export interface ExpressionTransformRequest {
  expression: string;
  new_column_name?: string | null;
  preview_limit?: number;
}

export interface ReplaceRequest {
  source_column: string;
  pattern: string;
  replacement: string;
  output_column_name?: string | null;
  preview_limit?: number;
  mode?: 'replace' | 'extract';
  count?: 'all' | 'first';
  n?: number | null;
  connector?: string;
}

export interface ExpressionApplyResponse {
  state: 'successful';
  node_id: string;
  column_name: string;
  expression: string;
  dtype?: string | null;
  message: string;
}

export interface ReplaceApplyResponse {
  state: 'successful';
  node_id: string;
  column_name: string;
  dtype?: string | null;
  message: string;
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
  info: (node: string, headers: Record<string,string> = {}) => get<NodeInfoResponse>(`/workspaces/nodes/${node}`, headers),
  data: (node: string, params: NodeDataParams = {}, headers: Record<string,string> = {}) => {
    const query: Record<string, unknown> = {
      page: params.page ?? 1,
      page_size: params.pageSize ?? 20,
    };
    if (params.sortBy) {
      query.sort_by = params.sortBy;
      query.descending = params.descending ?? false;
    }
    if (params.filterColumn && params.filterValue != null) {
      query.filter_column = params.filterColumn;
      query.filter_value = params.filterValue;
      query.filter_op = params.filterOp ?? 'contains';
    }
    return httpRequest<NodeDataResponse>(`/workspaces/nodes/${node}/data`, { method: 'GET', headers, params: query });
  },
  shape: (node: string, headers: Record<string,string> = {}) => get<Record<string, unknown>>(`/workspaces/nodes/${node}/shape`, headers),
  uniqueValues: (node: string, col: string, headers: Record<string,string> = {}) => get<ColumnUniqueValuesResponse>(`/workspaces/nodes/${node}/columns/${col}/unique`, headers),
  describeColumn: (node: string, col: string, headers: Record<string,string> = {}) => get<ColumnDescribeResponse>(`/workspaces/nodes/${node}/columns/${col}/describe`, headers),
  delete: (node: string, headers: Record<string,string> = {}) => del<Record<string, unknown>>(`/workspaces/nodes/${node}`, headers),
  rename: (node: string, newName: string, headers: Record<string,string> = {}) => httpRequest<Record<string, unknown>>(`/workspaces/nodes/${node}/name`, { method: 'PUT', headers, params: { new_name: newName } }),
  clone: (node: string, headers: Record<string,string> = {}) => httpRequest<Record<string, unknown>>(`/workspaces/nodes/${node}/clone`, { method: 'POST', headers }),
  undo: (node: string, headers: Record<string, string> = {}) =>
    httpRequest<NodeInfoResponse>(`/workspaces/nodes/${node}/undo`, { method: 'POST', headers }),
  redo: (node: string, headers: Record<string, string> = {}) =>
    httpRequest<NodeInfoResponse>(`/workspaces/nodes/${node}/redo`, { method: 'POST', headers }),
  queryPlan: (node: string, headers: Record<string, string> = {}) =>
    get<QueryPlanResponse>(`/workspaces/nodes/${node}/query-plan`, headers),
  renameColumn: (node: string, column: string, newName: string, headers: Record<string,string> = {}) =>
    httpRequest<Record<string, unknown>>(`/workspaces/nodes/${node}/columns/${encodeURIComponent(column)}`, {
      method: 'PUT',
      headers,
      body: { new_name: newName },
    }),
  deleteColumn: (node: string, column: string, headers: Record<string,string> = {}) =>
    httpRequest<Record<string, unknown>>(`/workspaces/nodes/${node}/columns/${encodeURIComponent(column)}`, {
      method: 'DELETE',
      headers,
    }),
  createFromFile: (filename: string, nodeName?: string, headers: Record<string,string> = {}, sheetName?: string) =>
    httpRequest<Record<string, unknown>>(`/workspaces/nodes`, {
      method: 'POST',
      headers,
      params: {
        filename,
        node_name: nodeName,
        mode: 'LazyFrame',
        ...(sheetName ? { sheet_name: sheetName } : {}),
      },
    }),
  join: (req: JoinNodesRequest, headers: Record<string,string> = {}) => httpRequest<Record<string, unknown>>(`/workspaces/nodes/join`, { method: 'POST', headers, params: req as unknown as Record<string, unknown> }),
  joinPreview: (
    req: JoinPreviewParams,
    page = 1,
    pageSize = 10,
    headers: Record<string,string> = {},
  ) => {
    const params: Record<string, string | number | undefined> = {
      left_node_id: req.left_node_id,
      right_node_id: req.right_node_id,
      how: req.how ?? 'inner',
      page,
      page_size: pageSize,
    };
    if (req.left_on) params.left_on = req.left_on;
    if (req.right_on) params.right_on = req.right_on;
    return httpRequest<FilterPreviewResponse>(
      `/workspaces/nodes/join/preview`,
      { method: 'POST', headers, params }
    );
  },
  concatPreview: (
    req: ConcatPreviewRequest,
    page = 1,
    pageSize = 10,
    headers: Record<string,string> = {},
  ) => httpRequest<FilterPreviewResponse>(
    `/workspaces/nodes/concat/preview`,
    { method: 'POST', headers, params: { page, page_size: pageSize }, body: req }
  ),
  concat: (req: ConcatRequest, headers: Record<string,string> = {}) => post<Record<string, unknown>>(`/workspaces/nodes/concat`, req, headers),
  cast: (node: string, req: CastNodeRequest, headers: Record<string,string> = {}) => post<Record<string, unknown>>(`/workspaces/nodes/${node}/cast`, req, headers),
  filter: async (node: string, req: FilterRequest, headers: Record<string,string> = {}): Promise<void> => { await post(`/workspaces/nodes/${node}/filter`, req, headers); },
  filterPreview: (node: string, req: FilterRequest, page = 1, pageSize = 10, headers: Record<string,string> = {}) => httpRequest<FilterPreviewResponse>(
    `/workspaces/nodes/${node}/filter/preview`,
    { method: 'POST', headers, params: { page, page_size: pageSize }, body: req }
  ),
  slicePreview: (node: string, req: SliceRequest, page = 1, pageSize = 10, headers: Record<string,string> = {}) => httpRequest<FilterPreviewResponse>(
    `/workspaces/nodes/${node}/slice/preview`,
    { method: 'POST', headers, params: { page, page_size: pageSize }, body: req }
  ),
  slice: (node: string, req: SliceRequest, headers: Record<string,string> = {}) => post<Record<string, unknown>>(`/workspaces/nodes/${node}/slice`, req, headers),
  computeColumnPreview: (
    node: string,
    req: ExpressionTransformRequest,
    page = 1,
    pageSize = 10,
    headers: Record<string, string> = {}
  ) => httpRequest<FilterPreviewResponse>(
    `/workspaces/nodes/${node}/compute-column/preview`,
    { method: 'POST', headers, params: { page, page_size: pageSize }, body: req }
  ),
  computeColumn: (
    node: string,
    req: ExpressionTransformRequest,
    headers: Record<string, string> = {}
  ) => httpRequest<ExpressionApplyResponse>(
    `/workspaces/nodes/${node}/compute-column`,
    { method: 'POST', headers, body: req }
  ),
  replaceTextPreview: (
    node: string,
    req: ReplaceRequest,
    page = 1,
    pageSize = 10,
    headers: Record<string, string> = {}
  ) => httpRequest<FilterPreviewResponse>(
    `/workspaces/nodes/${node}/replace/preview`,
    { method: 'POST', headers, params: { page, page_size: pageSize }, body: req }
  ),
  replaceText: (
    node: string,
    req: ReplaceRequest,
    headers: Record<string, string> = {}
  ) => httpRequest<ReplaceApplyResponse>(
    `/workspaces/nodes/${node}/replace`,
    { method: 'POST', headers, body: req }
  ),
};
