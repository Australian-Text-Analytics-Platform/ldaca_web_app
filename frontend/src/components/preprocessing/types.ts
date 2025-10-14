/**
 * Shared types for data preprocessing components
 */

export type ConditionRange = { start: string | Date | null; end: string | Date | null };
export type ConditionValue = string | number | boolean | Date | ConditionRange | null;

export interface FilterCondition {
  column: string;
  operator: 'eq' | 'gte' | 'lte' | 'contains' | 'startswith' | 'endswith' | 'is_null' | 'between';
  value: ConditionValue;
  negate?: boolean;
  regex?: boolean;
}

export interface FilterRequest {
  conditions: FilterCondition[];
  logic?: string;
  new_node_name?: string;
}

/** Extended interface for UI with tracking ID */
export interface FilterConditionWithId extends Omit<FilterCondition, 'value'> {
  id: string;
  dataType?: string;
  value: ConditionValue;
  negate?: boolean;
  regex?: boolean;
}

export type PreviewPagination = {
  page: number;
  page_size: number;
  total_rows: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
};

export type PreviewRow = Record<string, unknown>;

export type JoinType = 'inner' | 'left' | 'right' | 'full' | 'semi' | 'anti' | 'cross';

export interface JoinPreviewRequestSignature {
  leftNodeId: string;
  rightNodeId: string;
  leftOn?: string;
  rightOn?: string;
  joinType: JoinType;
  page: number;
  pageSize: number;
}

export interface ConcatPreviewRequestSignature {
  nodeIds: string[];
  page: number;
  pageSize: number;
}

export interface ConcatNodeSummary {
  nodeId: string;
  displayName: string;
  columns: string[];
  normalizedColumns: string[];
  dtypes: Record<string, string>;
  rawDtypes: Record<string, string>;
  columnCount: number;
}

export interface ConcatSchemaMismatch {
  nodeId: string;
  nodeName: string;
  details: string[];
}

export interface ConcatSchemaAnalysis {
  summaries: ConcatNodeSummary[];
  ready: boolean;
  issues: string;
  mismatches: ConcatSchemaMismatch[];
  baseColumns: string[];
  baseColumnCount: number;
}

export const PREVIEW_PAGE_SIZE_OPTIONS = [10, 20, 50];
export const MAX_CONCAT_NODES = 6;

export const JOIN_TYPE_OPTIONS: Array<{ value: JoinType; description: string }> = [
  { value: 'inner', description: 'Only rows with matching keys in both nodes.' },
  { value: 'left', description: 'All rows from the left node plus matching rows from the right.' },
  { value: 'right', description: 'All rows from the right node plus matching rows from the left.' },
  { value: 'full', description: 'All rows from both nodes; missing matches become nulls.' },
  { value: 'semi', description: 'Rows from the left node that have at least one match in the right.' },
  { value: 'anti', description: 'Rows from the left node that do not match anything in the right.' },
  { value: 'cross', description: 'Cartesian product of all rows; ignores column selections.' },
];
