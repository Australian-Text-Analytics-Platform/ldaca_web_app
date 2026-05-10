export type PaginationState = {
  currentPage: number;
  totalPages: number;
  pageSize: number;
  totalItems: number;
  sortBy?: string;
  descending?: boolean;
  filterColumn?: string;
  filterValue?: string;
  filterOp?: string;
};

export type PaginationMap = Record<string, PaginationState>;

export const createDefaultPagination = (): PaginationState => ({
  currentPage: 1,
  totalPages: 1,
  pageSize: 20,
  totalItems: 0,
});
