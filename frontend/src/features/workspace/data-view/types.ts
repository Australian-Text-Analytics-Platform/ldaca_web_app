export type DataRow = Record<string, unknown>;

export type { NodeDataPagination as PaginationInfo } from '@/types/api';

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
