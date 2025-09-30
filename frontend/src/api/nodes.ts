import { get, post, del, httpRequest } from './http';

export type ConversionTarget = 'docdataframe' | 'dataframe' | 'doclazyframe' | 'lazyframe';

export interface ColumnUniqueValuesResponse { unique_count: number; sample_values: any[]; has_more: boolean; }

export interface ColumnDescribeResponse {
  column_name: string;
  count?: number;
  null_count?: number;
  mean?: number;
  std?: number;
  min?: any;
  percentile_25?: any;
  median?: any;
  percentile_75?: any;
  max?: any;
}

export interface FilterCondition {
  column: string;
  operator: 'eq' | 'gte' | 'lte' | 'contains' | 'startswith' | 'endswith' | 'is_null' | 'between';
  value: any;
  negate?: boolean;
  regex?: boolean;
}
export interface FilterRequest { conditions: FilterCondition[]; logic?: string; new_node_name?: string; }
export interface SliceRequest { start_row?: number; end_row?: number; columns?: string[]; new_node_name?: string; }
export interface JoinNodesRequest { left_node_id: string; right_node_id: string; left_on: string; right_on: string; how?: string; new_node_name?: string; }
export interface CastNodeRequest { column: string; target_type: string; format?: string; }
export interface FilterPreviewResponse {
  data: any[];
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

export const nodesApi = {
  info: (ws: string, node: string, headers: Record<string,string> = {}) => get(`/workspaces/${ws}/nodes/${node}`, headers),
  data: (ws: string, node: string, page = 0, pageSize = 20, headers: Record<string,string> = {}) => httpRequest(`/workspaces/${ws}/nodes/${node}/data`, { method: 'GET', headers, params: { page, page_size: pageSize } }),
  shape: (ws: string, node: string, headers: Record<string,string> = {}) => get(`/workspaces/${ws}/nodes/${node}/shape`, headers),
  uniqueValues: (ws: string, node: string, col: string, headers: Record<string,string> = {}) => get<ColumnUniqueValuesResponse>(`/workspaces/${ws}/nodes/${node}/columns/${col}/unique`, headers),
  describeColumn: (ws: string, node: string, col: string, headers: Record<string,string> = {}) => get<ColumnDescribeResponse>(`/workspaces/${ws}/nodes/${node}/columns/${col}/describe`, headers),
  delete: (ws: string, node: string, headers: Record<string,string> = {}) => del(`/workspaces/${ws}/nodes/${node}`, headers),
  rename: (ws: string, node: string, newName: string, headers: Record<string,string> = {}) => httpRequest(`/workspaces/${ws}/nodes/${node}/name`, { method: 'PUT', headers, params: { new_name: newName } }),
  createFromFile: (ws: string, filename: string, nodeName?: string, headers: Record<string,string> = {}, options?: { mode?: string; document_column?: string | null }) => httpRequest(`/workspaces/${ws}/nodes`, { method: 'POST', headers, params: { filename, node_name: nodeName, mode: options?.mode ?? 'DocLazyFrame', document_column: options?.document_column ?? undefined } }),
  convert: (ws: string, node: string, target: ConversionTarget, documentColumn?: string, headers: Record<string,string> = {}) => httpRequest(`/workspaces/${ws}/nodes/${node}/convert`, { method: 'POST', headers, params: { target, ...(documentColumn && { document_column: documentColumn }) } }),
  resetDocument: (ws: string, node: string, documentColumn?: string, headers: Record<string,string> = {}) => httpRequest(`/workspaces/${ws}/nodes/${node}/reset-document`, { method: 'POST', headers, params: documentColumn ? { document_column: documentColumn } : {} }),
  join: (ws: string, req: JoinNodesRequest, headers: Record<string,string> = {}) => httpRequest(`/workspaces/${ws}/nodes/join`, { method: 'POST', headers, params: req }),
  cast: (ws: string, node: string, req: CastNodeRequest, headers: Record<string,string> = {}) => post(`/workspaces/${ws}/nodes/${node}/cast`, req, headers),
  filter: (ws: string, node: string, req: FilterRequest, headers: Record<string,string> = {}) => post(`/workspaces/${ws}/nodes/${node}/filter`, req, headers),
  filterPreview: (ws: string, node: string, req: FilterRequest, page = 1, pageSize = 10, headers: Record<string,string> = {}) => httpRequest<FilterPreviewResponse>(
    `/workspaces/${ws}/nodes/${node}/filter/preview`,
    { method: 'POST', headers, params: { page, page_size: pageSize }, body: req }
  ),
  slice: (ws: string, node: string, req: SliceRequest, headers: Record<string,string> = {}) => post(`/workspaces/${ws}/nodes/${node}/slice`, req, headers),
};
