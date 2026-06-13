export type DataRow = Record<string, unknown>;

export type { PaginationInfo, PaginationInfo as NodeDataPagination } from '@/api';

export interface ServerSortingInfo {
  sort_by: string | null;
  descending: boolean;
}

export interface ServerFilteringInfo {
  column: string | null;
  value: string | null;
  op: string;
}

export type FilterOperator = 'contains' | 'eq' | 'startswith' | 'endswith';

/** Backend node shape tuple, with nulls when size is unknown. */
export type NodeShape = [number | null, number | null];

/** Rich node shape used by the workspace graph/table view. */
export interface WorkspaceNode {
  node_id: string;
  name: string;
  shape: NodeShape;
  columns: string[];
  preview: Record<string, unknown>[];
  is_text_data: boolean;
  can_undo?: boolean;
  can_redo?: boolean;
  data_type?: string;
  column_schema?: Record<string, string>;
  dtypes?: Record<string, string>;
  tokenizer_models?: Record<string, string>;
  [key: string]: unknown;
}

/** Compact schema payload used by column pickers that do not need full node metadata. */
export interface NodeSchemaResponse {
  node_id: string;
  schema: Record<string, string>;
  columns: string[];
  column_types: Record<string, string>;
  is_text_data: boolean;
  document_column?: string;
}
