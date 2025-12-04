export type DataRow = Record<string, unknown>;

export interface PaginationInfo {
  page: number;
  page_size: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
  [key: string]: unknown;
}
