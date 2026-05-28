/**
 * Generic hook for server-side TanStack Table with sorting, filtering,
 * and pagination delegated to the backend.
 *
 * The backend LazyFrame handles sort → filter → slice → collect, so the
 * frontend only manages UI state and triggers refetches via React Query.
 */
import { useState } from 'react';
import {
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnPinningState,
  type OnChangeFn,
  type PaginationState,
  type SortingState,
  type ColumnFiltersState,
  type TableOptions,
} from '@tanstack/react-table';

export interface ServerTableOptions<TData> {
  data: TData[];
  columns: ColumnDef<TData, unknown>[];
  rowCount: number;
  pageIndex?: number;
  pageSize?: number;
  sorting?: SortingState;
  columnFilters?: ColumnFiltersState;
  onPaginationChange?: (pagination: PaginationState) => void;
  onSortingChange?: (sorting: SortingState) => void;
  onColumnFiltersChange?: (filters: ColumnFiltersState) => void;
  /** Extra options forwarded to useReactTable (e.g. columnPinning state). */
  tableOptions?: Partial<TableOptions<TData>>;
}

/** Creates a TanStack Table instance whose sort/filter/page state drives backend queries. */
/**
 * Used by: src/features/preprocessing/components/PreviewTable.tsx because the hook needs local steps to normalize inputs before exposing stable state to consumers.
 * Flow: initialize controlled or internal sorting/filter state, bridge table change callbacks, then build a manual TanStack table for backend paging.
 */
export function useServerTable<TData>({
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
  const [columnPinning, setColumnPinning] = useState<ColumnPinningState>({ left: [] });

  const [internalSorting, setInternalSorting] = useState<SortingState>([]);
  const sorting = externalSorting ?? internalSorting;

  const [internalFilters, setInternalFilters] = useState<ColumnFiltersState>([]);
  const columnFilters = externalFilters ?? internalFilters;

  /** Bridges TanStack sorting updates into controlled or internal state. */
  /** Used by: useServerTable callback wiring in this module because the component or hook needs a named callback boundary for effect and prop handoff steps. */
  const handleSortingChange: OnChangeFn<SortingState> = (updater) => {
    const next = typeof updater === 'function' ? updater(sorting) : updater;
    setInternalSorting(next);
    onSortingChange?.(next);
  };

  /** Converts table pagination updates into caller-owned backend paging params. */
  /** Used by: useServerTable callback wiring in this module because the component or hook needs a named callback boundary for effect and prop handoff steps. */
  const handlePaginationChange: OnChangeFn<PaginationState> = (updater) => {
    const current = { pageIndex, pageSize };
    const next = typeof updater === 'function' ? updater(current) : updater;
    onPaginationChange?.(next);
  };

  /** Bridges column-filter updates into controlled or internal state for backend filtering. */
  /** Used by: useServerTable callback wiring in this module because the component or hook needs a named callback boundary for effect and prop handoff steps. */
  const handleColumnFiltersChange: OnChangeFn<ColumnFiltersState> = (updater) => {
    const next = typeof updater === 'function' ? updater(columnFilters) : updater;
    setInternalFilters(next);
    onColumnFiltersChange?.(next);
  };

  // eslint-disable-next-line react-hooks/incompatible-library -- useReactTable returns non-memoizable functions; React Compiler can skip this
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    rowCount,
    state: {
      pagination: { pageIndex, pageSize },
      sorting,
      columnFilters,
      columnPinning,
      ...tableOptions?.state,
    },
    onPaginationChange: handlePaginationChange,
    onSortingChange: handleSortingChange,
    onColumnFiltersChange: handleColumnFiltersChange,
    onColumnPinningChange: setColumnPinning,
    ...tableOptions,
    // Ensure state isn't overwritten by tableOptions spread.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  return table;
}
