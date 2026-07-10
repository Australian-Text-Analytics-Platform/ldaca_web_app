import { useMemo, useState } from 'react';
import type {
  Column as TableColumn,
  SortingState,
  ColumnFiltersState,
  PaginationState as TanstackPaginationState,
} from '@tanstack/react-table';
import {
  type ColumnDef,
  type ColumnPinningState,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { DatetimeFormatPanel } from '@/features/views/common/components/DatetimeFormatPanel';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { RowDetailPanel } from '@/features/views/common/components/RowDetailPanel';
import { useRowDetailDialog } from '@/features/views/common/components/useRowDetailDialog';
import { ServerPaginationFooter } from '@/features/views/common/components/ServerPaginationFooter';
import { WorkspaceColumnHeader } from './WorkspaceColumnHeader';
import { TopicDistributionBar } from './TopicDistributionBar';
import type { DataRow, FilterOperator, PaginationInfo } from '../types';
import { DATA_TYPES, getTypeDisplayName } from '../services/schemaMutations';
import { normalizeTypeName } from '../utils/columnTypes';
import { useColumnMutations } from '../hooks/useColumnMutations';

// --- Constants ---
const WIDE_COLUMN_THRESHOLD = 120;
const COLLAPSED_COLUMN_MAX_WIDTH = 320;
const EXPANDED_COLUMN_MAX_WIDTH = 960;
const WIDE_COLUMN_SAMPLE_LIMIT = 25;

// --- Props ---
export interface WorkspaceTableProps {
  data: DataRow[];
  columns: string[];
  loading?: boolean;
  workspaceId?: string;
  nodeId?: string;
  documentColumn?: string;
  onCast?: (column: string, targetType: string, format?: string) => Promise<void>;
  onRenameColumn?: (column: string, nextName: string) => Promise<void>;
  onDeleteColumn?: (column: string) => Promise<void>;
  onRefreshSchema?: () => Promise<unknown>;

  /** Server-side pagination info (1-indexed page from backend). */
  pagination?: PaginationInfo | null;
  /** Total row count from backend (used by TanStack for page count). */
  rowCount?: number;

  // Server-side state callbacks
  sorting?: SortingState;
  onSortingChange?: (sorting: SortingState) => void;
  columnFilters?: ColumnFiltersState;
  onColumnFiltersChange?: (filters: ColumnFiltersState) => void;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
}

/**
 * Server-backed data table for the selected workspace node. It owns table UI
 * state while delegating column mutations and row detail display to helpers.
 * Rendered by: useColumnMutations hook, useWorkspaceDataTable hook, ServerTablePagination component (rg call sites/imports) because selected nodes need one server-backed row surface.
 * Flow: server rows enter TanStack Table, UI handlers update sorting/filtering/pagination, and column actions call workspace mutations.
 */
export function WorkspaceTable({
  data,
  columns: responseColumns,
  loading = false,
  workspaceId,
  nodeId,
  documentColumn,
  onCast,
  onRenameColumn,
  onDeleteColumn,
  onRefreshSchema,
  pagination,
  rowCount,
  sorting = [],
  onSortingChange,
  columnFilters = [],
  onColumnFiltersChange,
  onPageChange,
  onPageSizeChange,
}: WorkspaceTableProps) {
  const [expandedColumns, setExpandedColumns] = useState<Record<string, boolean>>({});
  const [columnPinning, setColumnPinning] = useState<ColumnPinningState>({ left: [] });
  const {
    detailPayload,
    detailOpen,
    setDetailOpen,
    openDetail: openRowDetail,
  } = useRowDetailDialog();

  const sanitizedData = useMemo(() => (Array.isArray(data) ? data : []), [data]);
  const backendColumns = useMemo(
    () => responseColumns.filter((column) => column.trim().length > 0),
    [responseColumns],
  );

  const mutations = useColumnMutations({
    workspaceId,
    nodeId,
    columns: backendColumns,
    onCast,
    onRenameColumn,
    onDeleteColumn,
    onRefreshSchema,
  });

  const {
    columnTypes,
    loadingCast,
    columnActionLoading,
    renamingColumn,
    datetimeModal,
    closeDatetimeModal,
    handleDatetimeFormatConfirm,
    deleteColumnDialogOpen,
    setDeleteColumnDialogOpen,
    columnToDelete,
    requestDeleteColumn,
    confirmDeleteColumn,
    handleTypeChange,
    startRename,
    cancelRename,
    submitRename,
  } = mutations;

  const columns = useMemo(() => {
    if (backendColumns.length > 0) return backendColumns;
    return Object.keys(columnTypes);
  }, [backendColumns, columnTypes]);

  const wideColumns = useMemo(() => {
    const sampleRows = sanitizedData.slice(0, WIDE_COLUMN_SAMPLE_LIMIT);
    const result = new Set<string>();
    columns.forEach((col) => {
      let maxLen = col.length;
      for (const row of sampleRows) {
        // DataRow is typed non-null, but rows arrive from API/JSON so guard malformed (null) rows.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (!row || typeof row !== 'object') continue;
        const raw = row[col];
        if (raw == null) continue;
        // Cell values may be objects; default stringification matches the existing width heuristic.
        // eslint-disable-next-line @typescript-eslint/no-base-to-string
        const display = typeof raw === 'string' ? raw : String(raw);
        maxLen = Math.max(maxLen, display.length);
        if (maxLen > WIDE_COLUMN_THRESHOLD) {
          result.add(col);
          break;
        }
      }
    });
    return result;
  }, [columns, sanitizedData]);

  // Filter helpers
  const activeFilter = columnFilters.length > 0 ? columnFilters[0] : null;
  const activeFilterColumn = activeFilter ? activeFilter.id : null;
  const activeFilterParts = activeFilter?.value as
    | { value: string; op: FilterOperator }
    | undefined;

  /**
   * Applies a server-side column filter and resets pagination.
   * Called by: WorkspaceTable internal event, effect, or helper flow.
   * Why: because the table needs helper handlers that translate UI events into server-backed query state and column actions.
   */
  const applyFilter = (col: string, value: string, op: FilterOperator) => {
    if (!value.trim()) {
      clearFilter(col);
      return;
    }
    onColumnFiltersChange?.([{ id: col, value: { value: value.trim(), op } }]);
    onPageChange?.(1);
  };

  /**
   * Clears server-side filters and returns to the first page.
   * Called by: WorkspaceTable internal event, effect, or helper flow.
   * Why: because the table needs helper handlers that translate UI events into server-backed query state and column actions.
   */
  const clearFilter = (_col: string) => {
    onColumnFiltersChange?.([]);
    onPageChange?.(1);
  };

  /**
   * Cycles one column through ascending, descending, and unsorted states.
   * Called by: WorkspaceTable internal event, effect, or helper flow.
   * Why: because the table needs helper handlers that translate UI events into server-backed query state and column actions.
   * Flow: inspect the current column sort state, choose the next asc/desc/none state, emit sorting changes, and reset to page one.
   */
  const handleSort = (columnId: string) => {
    const current = sorting.find((s) => s.id === columnId);
    let next: SortingState;
    if (!current) {
      next = [{ id: columnId, desc: false }];
    } else if (!current.desc) {
      next = [{ id: columnId, desc: true }];
    } else {
      next = [];
    }
    onSortingChange?.(next);
    onPageChange?.(1);
  };

  // Build column definitions
  const columnDefs: ColumnDef<DataRow>[] = columns.map((column) => {
    const currentType = normalizeTypeName(columnTypes[column] ?? 'string');
    const isColumnLoading = Boolean(loadingCast[column]);
    const isColumnMutating = Boolean(columnActionLoading[column]);
    const isColumnBusy = isColumnLoading || isColumnMutating;
    const displayLabel = getTypeDisplayName(currentType);
    const availableTypes = [
      { value: currentType, label: displayLabel },
      ...DATA_TYPES.filter((t) => t.value !== currentType),
    ];
    const isRenaming = renamingColumn === column;
    const canRename = Boolean(onRenameColumn);
    const canDelete = Boolean(onDeleteColumn);
    const isWideColumn = wideColumns.has(column);
    const isExpandedColumn = expandedColumns[column] === true;
    const isCollapsedColumn = isWideColumn && !isExpandedColumn;

    const sortState = sorting.find((s) => s.id === column);
    const isFiltered = activeFilterColumn === column;
    const isStringLike = ['string', 'categorical', 'unknown'].includes(currentType);

    /**
     * Toggles wide-column expansion without storing false entries.
     * Called by: WorkspaceTable internal event, effect, or helper flow.
     * Why: because the table needs helper handlers that translate UI events into server-backed query state and column actions.
     */
    const onToggleExpand = () => {
      setExpandedColumns((prev) => {
        if (prev[column]) {
          const { [column]: _, ...rest } = prev;
          return rest;
        }
        return { ...prev, [column]: true };
      });
    };

    return {
      id: column,
      /**
       * Reads row values by dynamic workspace column name for TanStack Table.
       * Called by: WorkspaceTable object consumers.
       * Why: because the table needs helper handlers that translate UI events into server-backed query state and column actions.
       */
      accessorFn: (row) => row[column],
      /**
       * Renders the interactive workspace column header controls.
       * Called by: WorkspaceTable object consumers.
       * Why: because the table needs helper handlers that translate UI events into server-backed query state and column actions.
       * Flow: pass column state, filter state, and mutation handlers into the lifted header component.
       */
      header: ({ column: colInst }) => (
        <WorkspaceColumnHeader
          column={column}
          colInst={colInst}
          currentType={currentType}
          displayLabel={displayLabel}
          availableTypes={availableTypes}
          isColumnBusy={isColumnBusy}
          isRenaming={isRenaming}
          canCast={Boolean(onCast)}
          canRename={canRename}
          canDelete={canDelete}
          isStringLike={isStringLike}
          isWideColumn={isWideColumn}
          isCollapsedColumn={isCollapsedColumn}
          onToggleExpand={onToggleExpand}
          sortState={sortState ? { id: sortState.id, desc: sortState.desc } : undefined}
          onSort={() => {
            handleSort(column);
          }}
          isFiltered={isFiltered}
          currentFilterOp={isFiltered && activeFilterParts ? activeFilterParts.op : 'contains'}
          currentFilterValue={isFiltered && activeFilterParts ? activeFilterParts.value : ''}
          onApplyFilter={applyFilter}
          onClearFilter={clearFilter}
          onStartRename={() => {
            startRename(column);
          }}
          onSubmitRename={submitRename}
          onCancelRename={cancelRename}
          onTypeChange={(newType) => {
            handleTypeChange(column, newType);
          }}
          onRequestDelete={() => {
            requestDeleteColumn(column);
          }}
        />
      ),
      /**
       * Renders a compact display value while preserving full text in the title.
       * Called by: WorkspaceTable object consumers.
       * Why: because the table needs helper handlers that translate UI events into server-backed query state and column actions.
       */
      cell: ({ getValue }) => {
        const cellValue = getValue();
        // Topic-distribution columns render as a stacked proportion bar rather
        // than stringified struct text.
        if (currentType === 'tmdist') {
          return <TopicDistributionBar value={cellValue} />;
        }
        // Cell values may be structs/objects; default stringification preserves prior display text.
        // eslint-disable-next-line @typescript-eslint/no-base-to-string
        const displayValue = cellValue == null ? '' : String(cellValue);
        return (
          <span className="block truncate" title={displayValue}>
            {displayValue}
          </span>
        );
      },
      meta: {
        headerClassName: 'whitespace-nowrap border-r border-border/70 px-2 py-2 text-left',
        headerMaxWidth: isWideColumn
          ? isCollapsedColumn
            ? COLLAPSED_COLUMN_MAX_WIDTH
            : EXPANDED_COLUMN_MAX_WIDTH
          : undefined,
        cellClassName:
          'whitespace-nowrap border-r border-border/60 px-2 py-1.5 text-sm text-foreground',
        cellMaxWidth: isWideColumn
          ? isCollapsedColumn
            ? COLLAPSED_COLUMN_MAX_WIDTH
            : EXPANDED_COLUMN_MAX_WIDTH
          : undefined,
      },
    } satisfies ColumnDef<DataRow>;
  });

  // TanStack Table instance (server-side)
  const pageIndex = pagination ? pagination.page - 1 : 0;
  const pageSize = pagination?.page_size ?? 20;
  const totalRows = rowCount ?? pagination?.total_rows ?? 0;

  /**
   * Bridges TanStack pagination updates to server pagination callbacks.
   * Called by: WorkspaceTable internal event, effect, or helper flow.
   * Why: because the table needs helper handlers that translate UI events into server-backed query state and column actions.
   */
  const handlePaginationChange = (
    updater: TanstackPaginationState | ((prev: TanstackPaginationState) => TanstackPaginationState),
  ) => {
    const current = { pageIndex, pageSize };
    const next = typeof updater === 'function' ? updater(current) : updater;
    if (next.pageSize !== pageSize) onPageSizeChange?.(next.pageSize);
    if (next.pageIndex !== pageIndex) onPageChange?.(next.pageIndex + 1);
  };

  /**
   * Bridges TanStack sorting updates to server sorting callbacks.
   * Called by: WorkspaceTable internal event, effect, or helper flow.
   * Why: because the table needs helper handlers that translate UI events into server-backed query state and column actions.
   */
  const handleSortingChangeInternal = (
    updater: SortingState | ((prev: SortingState) => SortingState),
  ) => {
    const next = typeof updater === 'function' ? updater(sorting) : updater;
    onSortingChange?.(next);
    onPageChange?.(1);
  };

  // eslint-disable-next-line react-hooks/incompatible-library -- useReactTable returns non-memoizable functions; React Compiler can skip this
  const tableInstance = useReactTable({
    data: sanitizedData,
    columns: columnDefs,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    rowCount: totalRows,
    state: {
      pagination: { pageIndex, pageSize },
      sorting,
      columnFilters,
      columnPinning,
    },
    onPaginationChange: handlePaginationChange,
    onSortingChange: handleSortingChangeInternal,
    onColumnPinningChange: setColumnPinning,
  });

  /**
   * Computes sticky styles for pinned TanStack columns.
   * Called by: WorkspaceTable internal event, effect, or helper flow.
   * Why: because the table needs helper handlers that translate UI events into server-backed query state and column actions.
   * Flow: read the column pin state, set sticky offsets, then add edge shadows for pinned sides.
   */
  const getPinnedStyles = (
    col: TableColumn<DataRow>,
    variant: 'header' | 'cell',
  ): React.CSSProperties | undefined => {
    const pinState = col.getIsPinned();
    if (!pinState) return undefined;
    const style: React.CSSProperties = {
      position: 'sticky',
      zIndex: variant === 'header' ? 30 : 5,
    };
    if (variant === 'header') style.top = 0;
    if (pinState === 'left') {
      style.left = `${String(col.getStart('left'))}px`;
      style.boxShadow =
        variant === 'header'
          ? '2px 0 0 -1px rgba(15, 23, 42, 0.12)'
          : '2px 0 0 -1px rgba(15, 23, 42, 0.08)';
    } else {
      style.right = `${String(col.getStart('right'))}px`;
      style.boxShadow =
        variant === 'header'
          ? '-2px 0 0 -1px rgba(15, 23, 42, 0.12)'
          : '-2px 0 0 -1px rgba(15, 23, 42, 0.08)';
    }
    return style;
  };

  const tableRows = tableInstance.getRowModel().rows;
  const visibleColumnCount = Math.max(tableInstance.getVisibleLeafColumns().length, 1);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex items-center space-x-3">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <span className="text-sm font-medium text-muted-foreground">Loading data...</span>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex h-full w-full flex-col min-h-0">
        <ScrollArea type="always" scrollbars="both" className="flex-1 bg-white">
          <Table disableContainer className="w-max table-auto">
            <TableHeader className="sticky top-0 z-20 bg-muted">
              {tableInstance.getHeaderGroups().map((hg) => (
                <TableRow key={hg.id}>
                  {hg.headers.map((header) => {
                    const meta = header.column.columnDef.meta;
                    return (
                      <TableHead
                        key={header.id}
                        className={cn(
                          meta?.headerClassName,
                          'h-8 px-1 py-1 last:border-r-0',
                          header.column.getIsPinned() ? 'bg-muted shadow-sm' : 'bg-muted',
                        )}
                        style={{
                          ...(meta?.headerMinWidth
                            ? { minWidth: `${String(meta.headerMinWidth)}px` }
                            : {}),
                          ...(meta?.headerMaxWidth !== undefined
                            ? {
                                maxWidth: `${String(meta.headerMaxWidth)}px`,
                                width: `${String(meta.headerMaxWidth)}px`,
                                overflow: 'hidden',
                              }
                            : {}),
                          ...(meta?.headerMinWidth || meta?.headerMaxWidth !== undefined
                            ? {
                                transition:
                                  'max-width 200ms ease, width 200ms ease, min-width 200ms ease',
                              }
                            : {}),
                          ...getPinnedStyles(header.column, 'header'),
                        }}
                      >
                        {header.isPlaceholder
                          ? null
                          : flexRender(header.column.columnDef.header, header.getContext())}
                      </TableHead>
                    );
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody className="divide-y divide-border/60 bg-white">
              {tableRows.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer transition-colors duration-150 hover:bg-muted/40 [&>td]:px-1 [&>td]:py-1"
                  onClick={() => {
                    const detailTextColumn =
                      documentColumn &&
                      Object.prototype.hasOwnProperty.call(row.original, documentColumn)
                        ? documentColumn
                        : undefined;
                    openRowDetail({ record: { ...row.original }, textColumn: detailTextColumn });
                  }}
                >
                  {row.getVisibleCells().map((cell) => {
                    const meta = cell.column.columnDef.meta;
                    return (
                      <TableCell
                        key={cell.id}
                        className={cn(
                          meta?.cellClassName,
                          'last:border-r-0',
                          cell.column.getIsPinned() ? 'bg-white' : undefined,
                        )}
                        style={{
                          ...(meta?.cellMinWidth
                            ? { minWidth: `${String(meta.cellMinWidth)}px` }
                            : {}),
                          ...(meta?.cellMaxWidth !== undefined
                            ? {
                                maxWidth: `${String(meta.cellMaxWidth)}px`,
                                width: `${String(meta.cellMaxWidth)}px`,
                                overflow: 'hidden',
                              }
                            : {}),
                          ...(meta?.cellMinWidth || meta?.cellMaxWidth !== undefined
                            ? {
                                transition:
                                  'max-width 200ms ease, width 200ms ease, min-width 200ms ease',
                              }
                            : {}),
                          ...getPinnedStyles(cell.column, 'cell'),
                        }}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
              {tableRows.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={visibleColumnCount}
                    className="px-4 py-6 text-center text-sm text-muted-foreground"
                  >
                    No rows to display
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </ScrollArea>
        <ServerPaginationFooter
          table={tableInstance}
          pageIndex={pageIndex}
          pageSize={pageSize}
          rowCount={totalRows}
          compact
        />
      </div>

      <DatetimeFormatPanel
        open={datetimeModal.isOpen}
        onClose={closeDatetimeModal}
        onConfirm={handleDatetimeFormatConfirm}
        columnName={datetimeModal.column}
        sampleValues={sanitizedData
          .slice(0, 25)
          .map((row) => {
            const v = row[datetimeModal.column];
            // Sample values may be objects; default stringification preserves prior behavior.
            // eslint-disable-next-line @typescript-eslint/no-base-to-string
            return v == null ? '' : String(v);
          })
          .filter(Boolean)}
      />

      <ConfirmDialog
        open={deleteColumnDialogOpen}
        onOpenChange={setDeleteColumnDialogOpen}
        title="Delete Column"
        description={`Are you sure you want to delete column "${String(columnToDelete)}"? You can undo this action afterwards.`}
        confirmText="Delete"
        cancelText="Cancel"
        variant="destructive"
        onConfirm={() => {
          void confirmDeleteColumn();
        }}
      />

      <RowDetailPanel open={detailOpen} onOpenChange={setDetailOpen} payload={detailPayload} />
    </>
  );
}
