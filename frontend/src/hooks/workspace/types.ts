export type PaginationState = {
  currentPage: number;
  totalPages: number;
  pageSize: number;
  totalItems: number;
};

export type PaginationMap = Record<string, PaginationState>;

export const createDefaultPagination = (): PaginationState => ({
  currentPage: 1,
  totalPages: 1,
  pageSize: 20,
  totalItems: 0,
});
