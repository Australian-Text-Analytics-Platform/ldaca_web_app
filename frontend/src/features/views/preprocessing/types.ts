/**
 * Shared types for data preprocessing features
 */

import type { FilterConditionInput, JsonDataInput } from '@/api';
import type { Field } from 'apache-arrow';

type FilterOperator =
  | 'eq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains'
  | 'startswith'
  | 'endswith'
  | 'is_null'
  | 'between'
  | 'in';

export type FilterCondition = Omit<FilterConditionInput, 'operator' | 'value'> & {
  operator: FilterOperator;
  value?: JsonDataInput;
};

export interface FilterRequest {
  conditions: FilterCondition[];
  logic?: 'and' | 'or';
  name?: string;
}

/**
 * UI-side narrowing of the value space — what the filter form actually
 * produces before serialization. The serializer in
 * `filter/utils/serializers.ts` widens this into the `value: unknown`
 * the API accepts.
 */
export interface ConditionRange {
  start: string | Date | null;
  end: string | Date | null;
}
/** Value shape for a Topic Distribution filter condition: keep rows
 * where one topic's proportion (0..1) compares against the threshold. */
interface TopicDistributionConditionValue {
  topic_id: number;
  threshold: number;
}
export type ConditionValue =
  | string
  | number
  | boolean
  | Date
  | ConditionRange
  | TopicDistributionConditionValue
  | null
  | (string | number | boolean | Date | null)[];

export interface ConditionColumnOption {
  name: string;
  dataType: string;
  label?: string;
}

/**
 * Extended interface for UI with tracking ID. Uses camelCase
 * `caseSensitive` (the form state shape) which the serializer converts
 * to `case_sensitive` for the API.
 */
export interface FilterConditionWithId {
  id: string;
  column: string;
  operator: FilterOperator;
  value: ConditionValue;
  negate?: boolean;
  regex?: boolean;
  caseSensitive?: boolean;
  dataType?: string;
  [key: string]: ConditionValue | undefined;
}

export interface PreviewPagination {
  page: number;
  page_size: number;
  has_next: boolean;
}

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

export interface ConcatPreviewRequestPayload {
  workspaceId: string;
  nodeIds: string[];
  deduplicate: boolean;
}

export interface ConcatNodeSummary {
  nodeId: string;
  displayName: string;
  columns: string[];
  normalizedColumns: string[];
  fields: Record<string, Field>;
  columnCount: number;
}

interface ConcatSchemaMismatch {
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

export const JOIN_TYPE_OPTIONS: { value: JoinType; description: string }[] = [
  { value: 'inner', description: 'Only rows with matching keys in both data blocks.' },
  {
    value: 'left',
    description: 'All rows from the left data block plus matching rows from the right.',
  },
  {
    value: 'right',
    description: 'All rows from the right data block plus matching rows from the left.',
  },
  { value: 'full', description: 'All rows from both data blocks; missing matches become nulls.' },
  {
    value: 'semi',
    description: 'Rows from the left data block that have at least one match in the right.',
  },
  {
    value: 'anti',
    description: 'Rows from the left data block that do not match anything in the right.',
  },
  { value: 'cross', description: 'Cartesian product of all rows; ignores column selections.' },
];
