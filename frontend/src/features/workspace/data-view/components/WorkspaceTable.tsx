import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  SortingState,
  PaginationState as TanstackPaginationState,
} from '@tanstack/react-table';
import { type ColumnPinningState, flexRender, useTable } from '@tanstack/react-table';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { DatetimeFormatPanel } from '@/features/views/common/components/DatetimeFormatPanel';
import { RowDetailPanel } from '@/features/views/common/components/RowDetailPanel';
import { useRowDetailDialog } from '@/features/views/common/components/useRowDetailDialog';
import { ServerPaginationFooter } from '@/features/views/common/components/ServerPaginationFooter';
import { WorkspaceColumnHeader } from './WorkspaceColumnHeader';
import { TopicDistributionBar } from './TopicDistributionBar';
import type { DataRow, NodeTablePagination } from '../types';
import { arrowTypeName, type ArrowField } from '@/lib/arrow/arrowTable';
import { isTopicDistributionField } from '@/lib/arrow/semanticTypes';
import { DATA_TYPES, getTypeDisplayName, type ColumnCastType } from '../services/schemaMutations';
import { useColumnMutations } from '../hooks/useColumnMutations';
import {
  workspaceTableFeatures,
  type WorkspaceTableColumn,
  type WorkspaceTableColumnDef,
} from './workspaceTableFeatures';

// --- Constants ---
const WIDE_COLUMN_THRESHOLD = 120;
const COLLAPSED_COLUMN_MAX_WIDTH = 320;
const EXPANDED_COLUMN_MAX_WIDTH = 960;
const WIDE_COLUMN_SAMPLE_LIMIT = 25;

// --- Props ---
export interface WorkspaceTableProps {
  data: DataRow[];
  columns: string[];
  columnFields: Record<string, ArrowField>;
  loading?: boolean;
  /** Background fetch state that must not replace the current table shell. */
  fetching?: boolean;
  workspaceId?: string;
  nodeId?: string;
  documentColumn?: string;
  onCast?: (column: string, targetType: ColumnCastType, format?: string) => Promise<void>;
  onRenameColumn?: (column: string, nextName: string) => Promise<void>;
  onDeleteColumn?: (column: string) => Promise<void>;
  onRefreshSchema?: () => Promise<unknown>;

  /** Server-side pagination info (1-indexed page from backend). */
  pagination?: NodeTablePagination;
  /** Trustworthy total row count used by TanStack for exact page bounds. */
  rowCount?: number;
  /** Arrow page lookahead used only when the Data Block row count is unknown. */
  hasNext?: boolean;

  // Server-side state callbacks
  sorting?: SortingState;
  onSortingChange?: (sorting: SortingState) => void;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
}

/**
 * Server-backed data table for the selected workspace node. It owns table UI
 * state while delegating column mutations and row detail display to helpers.
 * Rendered by `WorkspaceDataTableFeature` as the selected node's server-backed row surface.
 * Flow: server rows enter TanStack Table, UI handlers update sorting/filtering/pagination, and column actions call workspace mutations.
 */
export function WorkspaceTable({
  data,
  columns: responseColumns,
  columnFields,
  loading = false,
  fetching = false,
  workspaceId,
  nodeId,
  documentColumn,
  onCast,
  onRenameColumn,
  onDeleteColumn,
  onRefreshSchema,
  pagination,
  rowCount,
  hasNext,
  sorting = [],
  onSortingChange,
  onPageChange,
  onPageSizeChange,
}: WorkspaceTableProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [expandedColumns, setExpandedColumns] = useState<Record<string, boolean>>({});
  const [columnPinning, setColumnPinning] = useState<ColumnPinningState>({ start: [], end: [] });
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

  // A cached owner switch may not enter the loading branch, so reset the
  // viewport explicitly when the workspace or Data Block identity changes.
  useEffect(() => {
    if (!viewportRef.current) return;
    viewportRef.current.scrollLeft = 0;
    viewportRef.current.scrollTop = 0;
  }, [workspaceId, nodeId]);

  const mutations = useColumnMutations({
    workspaceId,
    nodeId,
    columns: backendColumns,
    columnFields,
    onCast,
    onRenameColumn,
    onDeleteColumn,
    onRefreshSchema,
  });

  const {
    columnFields: mutationColumnFields,
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
    return Object.keys(mutationColumnFields);
  }, [backendColumns, mutationColumnFields]);

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

  /**
   * Cycles one column through ascending, descending, and unsorted states.
   * Passed to `WorkspaceColumnHeader` as `onSort`.
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
  const columnDefs: WorkspaceTableColumnDef[] = columns.map((column) => {
    const currentField = mutationColumnFields[column];
    const currentType = currentField ? arrowTypeName(currentField) : 'unknown';
    const isColumnLoading = Boolean(loadingCast[column]);
    const isColumnMutating = Boolean(columnActionLoading[column]);
    const isColumnBusy = isColumnLoading || isColumnMutating;
    const displayLabel = getTypeDisplayName(currentField);
    const availableTypes = [
      { value: currentType, label: displayLabel },
      ...DATA_TYPES.filter((t) => t.value !== currentType && t.label !== displayLabel),
    ];
    const isWideColumn = wideColumns.has(column);
    const isExpandedColumn = expandedColumns[column] === true;
    const isCollapsedColumn = isWideColumn && !isExpandedColumn;

    const sortState = sorting.find((s) => s.id === column);

    /**
     * Toggles wide-column expansion without storing false entries.
     * Passed to this column's `WorkspaceColumnHeader` as `onToggleExpand`.
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
       * Invoked by TanStack Table for each row in this column.
       */
      accessorFn: (row) => row[column],
      /**
       * Renders the interactive workspace column header controls.
       * Invoked by TanStack Table for this column's header cell.
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
          isRenaming={renamingColumn === column}
          canCast={Boolean(onCast)}
          canRename={Boolean(onRenameColumn)}
          canDelete={Boolean(onDeleteColumn)}
          isWideColumn={isWideColumn}
          isCollapsedColumn={isCollapsedColumn}
          onToggleExpand={onToggleExpand}
          sortState={sortState ? { id: sortState.id, desc: sortState.desc } : undefined}
          onSort={() => {
            handleSort(column);
          }}
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
       * Called by TanStack Table for each visible body cell in this column.
       */
      cell: ({ getValue }) => {
        const cellValue = getValue();
        // This renderer is selected by the exact extension identity published
        // in IPC metadata, not by a second frontend dtype alias.
        if (isTopicDistributionField(currentField)) {
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
        headerClassName: 'whitespace-nowrap border-r border-surface-border/70 px-2 py-2 text-left',
        headerMaxWidth: isWideColumn
          ? isCollapsedColumn
            ? COLLAPSED_COLUMN_MAX_WIDTH
            : EXPANDED_COLUMN_MAX_WIDTH
          : undefined,
        cellClassName:
          'whitespace-nowrap border-r border-surface-border/60 px-2 py-1.5 text-body text-foreground',
        cellMaxWidth: isWideColumn
          ? isCollapsedColumn
            ? COLLAPSED_COLUMN_MAX_WIDTH
            : EXPANDED_COLUMN_MAX_WIDTH
          : undefined,
      },
    } satisfies WorkspaceTableColumnDef;
  });

  // TanStack Table instance (server-side)
  const pageIndex = pagination ? pagination.page - 1 : 0;
  const pageSize = pagination?.page_size ?? 20;
  const totalRows = rowCount;
  // Known graph metadata wins when both signals exist. Otherwise TanStack gets
  // one page of lookahead without being given an invented total row count.
  const usesLookaheadPagination = rowCount === undefined && hasNext !== undefined;

  /**
   * Bridges TanStack pagination updates to server pagination callbacks.
   * Passed to `useTable` as `onPaginationChange`.
   */
  const handlePaginationChange = (
    updater: TanstackPaginationState | ((prev: TanstackPaginationState) => TanstackPaginationState),
  ) => {
    const current = { pageIndex, pageSize };
    const next = typeof updater === 'function' ? updater(current) : updater;
    if (next.pageSize !== pageSize || next.pageIndex !== pageIndex) {
      if (viewportRef.current) viewportRef.current.scrollTop = 0;
    }
    if (next.pageSize !== pageSize) onPageSizeChange?.(next.pageSize);
    if (next.pageIndex !== pageIndex) onPageChange?.(next.pageIndex + 1);
  };

  /**
   * Bridges TanStack sorting updates to server sorting callbacks.
   * Passed to `useTable` as `onSortingChange`.
   */
  const handleSortingChangeInternal = (
    updater: SortingState | ((prev: SortingState) => SortingState),
  ) => {
    const next = typeof updater === 'function' ? updater(sorting) : updater;
    onSortingChange?.(next);
    onPageChange?.(1);
  };

  const tableInstance = useTable({
    features: workspaceTableFeatures,
    data: sanitizedData,
    columns: columnDefs,
    manualPagination: true,
    manualSorting: true,
    rowCount: usesLookaheadPagination ? undefined : totalRows,
    pageCount: usesLookaheadPagination ? pageIndex + 1 + (hasNext ? 1 : 0) : undefined,
    state: {
      pagination: { pageIndex, pageSize },
      sorting,
      columnPinning,
    },
    onPaginationChange: handlePaginationChange,
    onSortingChange: handleSortingChangeInternal,
    onColumnPinningChange: setColumnPinning,
  });

  /**
   * Computes sticky styles for pinned TanStack columns.
   * Called while rendering pinned header and body cells.
   * Flow: read the column pin state, set sticky offsets, then add edge shadows for pinned sides.
   */
  const getPinnedStyles = (
    col: WorkspaceTableColumn,
    variant: 'header' | 'cell',
  ): React.CSSProperties | undefined => {
    const pinState = col.getIsPinned();
    if (!pinState) return undefined;
    const style: React.CSSProperties = {
      position: 'sticky',
      zIndex: variant === 'header' ? 30 : 5,
    };
    if (variant === 'header') style.top = 0;
    if (pinState === 'start') {
      style.insetInlineStart = `${String(col.getStart('start'))}px`;
      style.boxShadow = '2px 0 0 -1px var(--vscode-surface-border)';
    } else {
      style.insetInlineEnd = `${String(col.getStart('end'))}px`;
      style.boxShadow = '-2px 0 0 -1px var(--vscode-surface-border)';
    }
    return style;
  };

  const tableRows = tableInstance.getRowModel().rows;
  const visibleColumnCount = Math.max(tableInstance.getVisibleLeafColumns().length, 1);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex items-center space-x-3">
          <Loader2 className="h-6 w-6 animate-spin text-link" />
          <span className="text-body font-medium text-description">Loading data...</span>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex h-full w-full flex-col min-h-0">
        <ScrollArea viewportRef={viewportRef} scrollbars="both" className="flex-1 bg-surface">
          <Table disableContainer className="w-max table-auto">
            <TableHeader className="sticky top-0 z-20 bg-panel">
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
                          header.column.getIsPinned() ? 'bg-panel' : 'bg-panel',
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
            <TableBody className="divide-y divide-border/60 bg-surface">
              {tableRows.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer transition-colors duration-150 hover:bg-panel/40 [&>td]:px-1 [&>td]:py-1"
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
                          cell.column.getIsPinned() ? 'bg-surface' : undefined,
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
                    className="px-4 py-6 text-center text-body text-description"
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
          rowCount={usesLookaheadPagination ? undefined : totalRows}
          hasNext={usesLookaheadPagination ? hasNext : undefined}
          loading={fetching}
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

      <AlertDialog open={deleteColumnDialogOpen} onOpenChange={setDeleteColumnDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete column</AlertDialogTitle>
            <AlertDialogDescription>
              Delete column &quot;{columnToDelete}&quot; from this Data Block? You can undo this
              while the Workspace remains open.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-error text-button-foreground hover:bg-error/90"
              onClick={() => {
                void confirmDeleteColumn();
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <RowDetailPanel open={detailOpen} onOpenChange={setDetailOpen} payload={detailPayload} />
    </>
  );
}
