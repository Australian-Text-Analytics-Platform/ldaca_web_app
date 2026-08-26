/**
 * Generic hook for server-side TanStack Table with sorting, filtering,
 * and pagination delegated to the backend.
 *
 * The backend LazyFrame handles sort → filter → slice → collect, so the
 * frontend only manages UI state and triggers refetches via React Query.
 *
 * Shared across the workspace data view and the analysis result tables
 * (concordance, quotation, etc.) so every on-demand paginated table
 * shares one TanStack instance contract instead of hand-rolling markup.
 */
import { useState } from 'react';
import {
  columnFilteringFeature,
  columnPinningFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type ColumnDef,
  type ColumnFiltersState,
  type ColumnPinningState,
  type OnChangeFn,
  type PaginationState,
  type RowData,
  type SortingState,
  type Header,
  type Table,
  type TableOptions,
} from '@tanstack/react-table';

const serverTableFeatures = tableFeatures({
  columnFilteringFeature,
  columnPinningFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  rowPaginationFeature,
  rowSortingFeature,
});

type ServerTableFeatures = typeof serverTableFeatures;
export type ServerColumnDef<TData extends RowData, TValue = unknown> = ColumnDef<
  ServerTableFeatures,
  TData,
  TValue
>;
export type ServerTableInstance<TData extends RowData> = Table<ServerTableFeatures, TData>;
export type ServerTableHeader<TData extends RowData, TValue = unknown> = Header<
  ServerTableFeatures,
  TData,
  TValue
>;

export interface ServerTableOptions<TData extends RowData> {
  data: TData[];
  columns: ServerColumnDef<TData>[];
  rowCount: number;
  pageIndex?: number;
  pageSize?: number;
  sorting?: SortingState;
  columnFilters?: ColumnFiltersState;
  onPaginationChange?: (pagination: PaginationState) => void;
  onSortingChange?: (sorting: SortingState) => void;
  onColumnFiltersChange?: (filters: ColumnFiltersState) => void;
  /** Extra options forwarded to useTable (e.g. columnPinning state). */
  tableOptions?: Partial<TableOptions<ServerTableFeatures, TData>>;
}

/** Creates a TanStack Table instance whose sort/filter/page state drives backend queries. */
/**
 * Used by: Annotation preview/results, preprocessing `PreviewTable`,
 * Concordance table/dispersion blocks, and `QuotationNodeBlock`.
 * Flow: initialize controlled or internal sorting/filter state, bridge table
 * change callbacks, then build a manual TanStack table for backend paging.
 */
export function useServerTable<TData extends RowData>({
  data,
  columns,
  rowCount,
  pageIndex = 0,
  pageSize = 20,
  sorting: externalSorting,
  columnFilters: externalFilters,
  onPaginationChange,
  onSortingChange,
  onColumnFiltersChange,
  tableOptions,
}: ServerTableOptions<TData>) {
  const [columnPinning, setColumnPinning] = useState<ColumnPinningState>({ start: [], end: [] });

  const [internalSorting, setInternalSorting] = useState<SortingState>([]);
  const sorting = externalSorting ?? internalSorting;

  const [internalFilters, setInternalFilters] = useState<ColumnFiltersState>([]);
  const columnFilters = externalFilters ?? internalFilters;

  /** Bridges TanStack sorting updates into controlled or internal state. */
  /** Passed to: TanStack Table as `onSortingChange`. */
  const handleSortingChange: OnChangeFn<SortingState> = (updater) => {
    const next = typeof updater === 'function' ? updater(sorting) : updater;
    setInternalSorting(next);
    onSortingChange?.(next);
  };

  /** Converts table pagination updates into caller-owned backend paging params. */
  /** Passed to: TanStack Table as `onPaginationChange`. */
  const handlePaginationChange: OnChangeFn<PaginationState> = (updater) => {
    const current = { pageIndex, pageSize };
    const next = typeof updater === 'function' ? updater(current) : updater;
    onPaginationChange?.(next);
  };

  /** Bridges column-filter updates into controlled or internal state for backend filtering. */
  /** Passed to: TanStack Table as `onColumnFiltersChange`. */
  const handleColumnFiltersChange: OnChangeFn<ColumnFiltersState> = (updater) => {
    const next = typeof updater === 'function' ? updater(columnFilters) : updater;
    setInternalFilters(next);
    onColumnFiltersChange?.(next);
  };

  const { state: tableOptionsState, ...restTableOptions } = tableOptions ?? {};

  const table = useTable({
    features: serverTableFeatures,
    data,
    columns,
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    rowCount,
    state: {
      pagination: { pageIndex, pageSize },
      sorting,
      columnFilters,
      columnPinning,
      ...tableOptionsState,
    },
    onPaginationChange: handlePaginationChange,
    onSortingChange: handleSortingChange,
    onColumnFiltersChange: handleColumnFiltersChange,
    onColumnPinningChange: setColumnPinning,
    ...restTableOptions,
  });

  return table;
}
