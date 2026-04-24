/**
 * Generic hook for client-side TanStack Table where all data lives
 * in the browser.  Sorting, filtering, and pagination are handled
 * entirely by TanStack's built-in row models.
 */
import {
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  type TableOptions,
} from '@tanstack/react-table';
import { useState } from 'react';

export interface LocalTableOptions<TData> {
  data: TData[];
  columns: ColumnDef<TData, unknown>[];
  initialPageSize?: number;
  /** Extra options forwarded to useReactTable. */
  tableOptions?: Partial<TableOptions<TData>>;
}

export function useLocalTable<TData>({
  data,
  columns,
  initialPageSize = 20,
  tableOptions,
}: LocalTableOptions<TData>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  // eslint-disable-next-line react-hooks/incompatible-library -- useReactTable returns non-memoizable functions; React Compiler can skip this
  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      columnFilters,
      pagination: { pageIndex: 0, pageSize: initialPageSize },
      ...tableOptions?.state,
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    ...tableOptions,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  return table;
}
