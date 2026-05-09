/**
 * Shared types for data preprocessing features
 */

export type ConditionRange = { start: string | Date | null; end: string | Date | null };
export type ConditionValue =
  | string
  | number
  | boolean
  | Date
  | ConditionRange
  | null
  | Array<string | number | boolean | Date | null>;

export interface FilterCondition {
  [key: string]: ConditionValue | string | boolean | undefined;
  column: string;
  operator: 'eq' | 'gte' | 'lte' | 'contains' | 'startswith' | 'endswith' | 'is_null' | 'between' | 'in';
  value: ConditionValue;
  negate?: boolean;
  regex?: boolean;
  case_sensitive?: boolean;
}

export interface ConditionColumnOption {
  name: string;
  dataType: string;
  label?: string;
}

export interface FilterRequest {
  conditions: FilterCondition[];
  logic?: string;
  new_node_name?: string;
}

/** Extended interface for UI with tracking ID */
export interface FilterConditionWithId {
  id: string;
  column: string;
  operator: 'eq' | 'gte' | 'lte' | 'contains' | 'startswith' | 'endswith' | 'is_null' | 'between' | 'in';
  value: ConditionValue;
  negate?: boolean;
  regex?: boolean;
  caseSensitive?: boolean;
  dataType?: string;
  [key: string]: ConditionValue | string | boolean | undefined;
}

export type { NodeDataPagination as PreviewPagination } from '@/types/api';

export type PreviewRow = Record<string, unknown>;

export type JoinType = 'inner' | 'left' | 'right' | 'full' | 'semi' | 'anti' | 'cross';

export interface JoinPreviewRequestPayload {
  workspaceId: string;
  leftNodeId: string;
  rightNodeId: string;
  leftOn?: string;
  rightOn?: string;
  joinType: JoinType;
}

export interface JoinPreviewRequestSignature {
  leftNodeId: string;
  rightNodeId: string;
  leftOn?: string;
  rightOn?: string;
  joinType: JoinType;
  page: number;
  pageSize: number;
}

export interface ConcatPreviewRequestPayload {
  nodeIds: string[];
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
export const MAX_JOIN_NODES = 2;

export const JOIN_TYPE_OPTIONS: Array<{ value: JoinType; description: string }> = [
  { value: 'inner', description: 'Only rows with matching keys in both data blocks.' },
  { value: 'left', description: 'All rows from the left data block plus matching rows from the right.' },
  { value: 'right', description: 'All rows from the right data block plus matching rows from the left.' },
  { value: 'full', description: 'All rows from both data blocks; missing matches become nulls.' },
  { value: 'semi', description: 'Rows from the left data block that have at least one match in the right.' },
  { value: 'anti', description: 'Rows from the left data block that do not match anything in the right.' },
  { value: 'cross', description: 'Cartesian product of all rows; ignores column selections.' },
];
