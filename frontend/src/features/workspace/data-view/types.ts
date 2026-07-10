export type DataRow = Record<string, unknown>;

export type { PaginationInfo, PaginationInfo as NodeDataPagination } from '@/api';

export type FilterOperator = 'contains' | 'eq' | 'startswith' | 'endswith';
