export interface PaginationState {
  currentPage: number;
  totalPages: number;
  pageSize: number;
  totalItems: number;
  sortBy?: string;
  descending?: boolean;
  filterColumn?: string;
  filterValue?: string;
  filterOp?: string;
}

export type PaginationMap = Record<string, PaginationState>;

/**
 * Creates the default per-node pagination used before data has loaded.
 * Used by: useWorkspaceCore hook (rg call sites/imports).
 * Why: because workspace hooks need a shared default pagination shape before per-node paging state exists.
 */
export const createDefaultPagination = (): PaginationState => ({
  currentPage: 1,
  totalPages: 1,
  pageSize: 20,
  totalItems: 0,
});
