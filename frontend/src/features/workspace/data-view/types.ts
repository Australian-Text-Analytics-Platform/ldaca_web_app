export type DataRow = Record<string, unknown>;

export interface PaginationInfo {
  page: number;
  page_size: number;
  total_rows?: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
  [key: string]: unknown;
}

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
