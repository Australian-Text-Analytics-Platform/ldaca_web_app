import { useEffect, useRef, useState } from 'react';
import type { Column as TableColumn, SortingState, ColumnFiltersState, PaginationState as TanstackPaginationState } from '@tanstack/react-table';
import { type ColumnDef, type ColumnPinningState, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, Expand, Filter, Loader2, Minimize, Pin, Settings2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { DatetimeFormatPanel } from '@/components/panels/DatetimeFormatPanel';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { RowDetailPanel } from '@/features/analysis/common/components/RowDetailPanel';
import { useRowDetailDialog } from '@/features/analysis/common/components/useRowDetailDialog';
import { ServerTablePagination } from './ServerTablePagination';
import type { DataRow, FilterOperator, PaginationInfo } from '../types';
import type { NodeSchemaResponse } from '@/types';
import { DATA_TYPES, extractColumnTypes, getTypeDisplayName, normalizeTypeName } from '../services/schemaMutations';

// --- Inline rename input ---
function RenameInput({
  column,
  disabled,
  onSubmit,
  onCancel,
}: {
  column: string;
  disabled: boolean;
  onSubmit: (column: string, value: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(column);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (el) { el.focus(); el.select(); }
  }, []);

  return (
    <Input
      ref={inputRef}
      value={draft}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (!disabled) onSubmit(column, draft); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); if (!disabled) onSubmit(column, draft); }
        else if (e.key === 'Escape') onCancel();
      }}
      className="h-7 w-40 truncate text-xs"
      aria-label={`Rename column ${column}`}
    />
  );
}

// --- Column filter form (rendered inside the settings dropdown sub-menu) ---
const FILTER_OPS: { value: FilterOperator; label: string }[] = [
  { value: 'contains', label: 'Contains' },
  { value: 'eq', label: 'Equals' },
  { value: 'startswith', label: 'Starts with' },
  { value: 'endswith', label: 'Ends with' },
];

function ColumnFilterForm({
  column,
  currentOp,
  currentValue,
  onApply,
  onClear,
}: {
  column: string;
  currentOp: FilterOperator;
  currentValue: string;
  onApply: (column: string, value: string, op: FilterOperator) => void;
  onClear: (column: string) => void;
}) {
  const [op, setOp] = useState<FilterOperator>(currentOp);
  const [value, setValue] = useState(currentValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      className="flex flex-col gap-2 p-2"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <span className="text-xs font-medium text-muted-foreground">Filter &quot;{column}&quot;</span>
      <select
        value={op}
        onChange={(e) => setOp(e.target.value as FilterOperator)}
        className="h-7 rounded-md border border-input bg-background px-2 text-xs"
      >
        {FILTER_OPS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Value..."
        className="h-7 text-xs"
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); onApply(column, value, op); }
        }}
      />
      <div className="flex gap-1">
        <Button size="sm" className="h-6 flex-1 text-xs" onClick={() => onApply(column, value, op)}>
          Apply
        </Button>
        {currentValue && (
          <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => onClear(column)}>
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}

// --- TanStack column meta ---
declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData, TValue> {
    headerClassName?: string;
    headerMinWidth?: number;
    headerMaxWidth?: number;
    cellClassName?: string;
    cellMinWidth?: number;
    cellMaxWidth?: number;
  }
}

// --- Constants ---
const WIDE_COLUMN_THRESHOLD = 120;
const COLLAPSED_COLUMN_MAX_WIDTH = 320;
const EXPANDED_COLUMN_MAX_WIDTH = 960;
const WIDE_COLUMN_SAMPLE_LIMIT = 25;

// --- Props ---
export interface WorkspaceTableProps {
  data: DataRow[];
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

export function WorkspaceTable({
  data,
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
  const [columnTypes, setColumnTypes] = useState<Record<string, string>>({});
  const [loadingCast, setLoadingCast] = useState<Record<string, boolean>>({});
  const [datetimeModal, setDatetimeModal] = useState<{ isOpen: boolean; column: string; targetType: string }>({ isOpen: false, column: '', targetType: '' });
  const [columnActionLoading, setColumnActionLoading] = useState<Record<string, boolean>>({});
  const [renamingColumn, setRenamingColumn] = useState<string | null>(null);
  const [expandedColumns, setExpandedColumns] = useState<Record<string, boolean>>({});
  const [deleteColumnDialogOpen, setDeleteColumnDialogOpen] = useState(false);
  const [columnToDelete, setColumnToDelete] = useState<string | null>(null);
  const [columnPinning, setColumnPinning] = useState<ColumnPinningState>({ left: [] });
  const { detailPayload, detailOpen, setDetailOpen, openDetail: openRowDetail } = useRowDetailDialog();

  const applySchema = (schema: unknown) => {
    const mapping = extractColumnTypes(schema as NodeSchemaResponse | null);
    setColumnTypes(mapping);
    return mapping;
  };

  useEffect(() => {
    if (!workspaceId || !nodeId || !onRefreshSchema) return;
    let cancelled = false;
    onRefreshSchema()
      .then((schema) => { if (!cancelled) applySchema(schema); })
      .catch((error) => { if (!cancelled) console.error('WorkspaceTable: failed to refresh schema', error); });
    return () => { cancelled = true; };
  }, [workspaceId, nodeId, onRefreshSchema]);

  const sanitizedData = Array.isArray(data) ? data : [];

  const columns = (() => {
    const firstRow = sanitizedData.find((row) => row && typeof row === 'object');
    if (firstRow) return Object.keys(firstRow);
    return Object.keys(columnTypes);
  })();

  const wideColumns = (() => {
    const sampleRows = sanitizedData.slice(0, WIDE_COLUMN_SAMPLE_LIMIT);
    const result = new Set<string>();
    columns.forEach((col) => {
      let maxLen = col.length;
      for (const row of sampleRows) {
        if (!row || typeof row !== 'object') continue;
        const raw = row[col];
        if (raw == null) continue;
        const display = typeof raw === 'string' ? raw : String(raw);
        maxLen = Math.max(maxLen, display.length);
        if (maxLen > WIDE_COLUMN_THRESHOLD) { result.add(col); break; }
      }
    });
    return result;
  })();

  const performCast = async (column: string, targetType: string, format?: string) => {
    if (!onCast) return;
    setLoadingCast((prev) => ({ ...prev, [column]: true }));
    try {
      await onCast(column, targetType, format);
      if (onRefreshSchema) { const schema = await onRefreshSchema(); applySchema(schema); }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`Failed to convert column "${column}" to ${targetType}: ${message}`);
    } finally {
      setLoadingCast((prev) => ({ ...prev, [column]: false }));
    }
  };

  const handleTypeChange = (column: string, newType: string) => {
    if (!onCast) return;
    const currentType = normalizeTypeName(columnTypes[column] ?? 'string');
    if (newType.toLowerCase() === currentType.toLowerCase()) return;
    const isStringToDatetime = newType.toLowerCase() === 'datetime' && (currentType === 'string' || currentType.includes('utf8'));
    if (isStringToDatetime) { setDatetimeModal({ isOpen: true, column, targetType: newType }); return; }
    void performCast(column, newType);
  };

  const handleDatetimeFormatConfirm = (format?: string) => {
    const { column, targetType } = datetimeModal;
    setDatetimeModal({ isOpen: false, column: '', targetType: '' });
    if (column && targetType) void performCast(column, targetType, format);
  };

  const setColumnBusy = (column: string, active: boolean) => {
    setColumnActionLoading((prev) => {
      if (active) return prev[column] ? prev : { ...prev, [column]: true };
      if (!(column in prev)) return prev;
      const { [column]: _, ...next } = prev;
      return next;
    });
  };

  const submitRename = async (column: string, value: string) => {
    if (!onRenameColumn) { setRenamingColumn(null); return; }
    const trimmed = value.trim();
    if (!trimmed) { toast.error('Column name cannot be empty.'); return; }
    if (trimmed === column) { setRenamingColumn(null); return; }
    if (columns.some((c) => c !== column && c === trimmed)) { toast.error(`A column named "${trimmed}" already exists.`); return; }
    setColumnBusy(column, true);
    try {
      await onRenameColumn(column, trimmed);
      if (onRefreshSchema) { const schema = await onRefreshSchema(); applySchema(schema); }
      setRenamingColumn(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`Failed to rename column "${column}": ${message}`);
    } finally { setColumnBusy(column, false); }
  };

  const confirmDeleteColumn = async () => {
    if (!columnToDelete || !onDeleteColumn) return;
    const column = columnToDelete;
    setDeleteColumnDialogOpen(false);
    setColumnToDelete(null);
    setColumnBusy(column, true);
    try {
      await onDeleteColumn(column);
      if (onRefreshSchema) { const schema = await onRefreshSchema(); applySchema(schema); }
      else {
        setColumnTypes((prev) => {
          if (!(column in prev)) return prev;
          const { [column]: _, ...next } = prev;
          return next;
        });
      }
      if (renamingColumn === column) setRenamingColumn(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`Failed to delete column "${column}": ${message}`);
    } finally { setColumnBusy(column, false); }
  };

  // Filter helpers
  const activeFilter = columnFilters.length > 0 ? columnFilters[0] : null;
  const activeFilterColumn = activeFilter ? String(activeFilter.id) : null;
  const activeFilterParts = activeFilter?.value as { value: string; op: FilterOperator } | undefined;

  const applyFilter = (col: string, value: string, op: FilterOperator) => {
    if (!value.trim()) { clearFilter(col); return; }
    onColumnFiltersChange?.([{ id: col, value: { value: value.trim(), op } }]);
    onPageChange?.(1);
  };

  const clearFilter = (_col: string) => {
    onColumnFiltersChange?.([]);
    onPageChange?.(1);
  };

  // Sorting helper
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
  const columnDefs: ColumnDef<DataRow, unknown>[] = columns.map((column) => {
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

    return {
      id: column,
      accessorFn: (row) => row?.[column],
      header: ({ column: colInst }) => {
        const isPinnedLeft = colInst.getIsPinned() === 'left';
        return (
          <div className="flex min-w-0 items-center gap-1">
            {/* Pin */}
            <button
              type="button"
              onClick={() => colInst.pin(isPinnedLeft ? false : 'left')}
              className={cn(
                'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-transparent text-muted-foreground transition-colors hover:bg-muted-foreground/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                isPinnedLeft && 'text-primary',
              )}
              aria-pressed={isPinnedLeft}
              aria-label={isPinnedLeft ? `Unpin column ${column}` : `Pin column ${column} to the left`}
            >
              <Pin className="h-3.5 w-3.5" fill={isPinnedLeft ? 'currentColor' : 'none'} />
            </button>

            {/* Name / rename */}
            {isRenaming ? (
              <RenameInput column={column} disabled={isColumnBusy} onSubmit={submitRename} onCancel={() => setRenamingColumn(null)} />
            ) : (
              <div className="min-w-0">
                {canRename ? (
                  <button
                    type="button"
                    className="block max-w-[160px] truncate text-left text-xs font-medium text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    onClick={() => { if (!isColumnBusy) setRenamingColumn(column); }}
                    disabled={isColumnBusy}
                    title={column}
                  >
                    {column}
                  </button>
                ) : (
                  <span className="block max-w-[160px] truncate text-xs font-medium text-foreground" title={column}>{column}</span>
                )}
              </div>
            )}

            {/* Sort indicator + click-to-sort */}
            <button
              type="button"
              onClick={() => handleSort(column)}
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
              aria-label={`Sort by ${column}`}
            >
              {sortState ? (
                sortState.desc
                  ? <ArrowDown className="h-3.5 w-3.5 text-primary" />
                  : <ArrowUp className="h-3.5 w-3.5 text-primary" />
              ) : (
                <ArrowUpDown className="h-3.5 w-3.5" />
              )}
            </button>

            {/* Data type selector */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isColumnBusy || !onCast}
                  className={cn('h-7 w-fit justify-between gap-1 px-1.5 text-xs font-medium', isColumnBusy && 'cursor-progress opacity-80')}
                  aria-label={`Change data type for column ${column}`}
                >
                  <span className="truncate">{displayLabel}</span>
                  {isColumnBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-40 p-1">
                <DropdownMenuRadioGroup value={currentType} onValueChange={(v) => { if (!isColumnBusy) handleTypeChange(column, v); }}>
                  {availableTypes.map((t) => <DropdownMenuRadioItem key={t.value} value={t.value} className="text-xs">{t.label}</DropdownMenuRadioItem>)}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Expand / collapse wide column */}
            {isWideColumn && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setExpandedColumns((prev) => prev[column] ? (() => { const { [column]: _, ...rest } = prev; return rest; })() : { ...prev, [column]: true })}
                className="h-7 w-7 shrink-0 text-muted-foreground hover:text-primary"
                aria-label={isCollapsedColumn ? `Expand column ${column}` : `Collapse column ${column}`}
              >
                {isCollapsedColumn ? <Expand className="h-3.5 w-3.5" /> : <Minimize className="h-3.5 w-3.5" />}
              </Button>
            )}

            {/* Settings dropdown: Rename / Delete / Filter */}
            {(canRename || canDelete || isStringLike) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={isColumnBusy}
                    className={cn('h-7 w-7 shrink-0 text-muted-foreground hover:text-primary', isColumnBusy && 'cursor-progress opacity-80')}
                    aria-label={`Column settings for ${column}`}
                  >
                    {isColumnBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Settings2 className="h-3.5 w-3.5" />}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52 p-1">
                  {canRename && (
                    <DropdownMenuItem disabled={isColumnBusy} onSelect={() => { if (!isColumnBusy) setRenamingColumn(column); }} className="text-xs">
                      Rename
                    </DropdownMenuItem>
                  )}
                  {canDelete && (
                    <DropdownMenuItem
                      disabled={isColumnBusy}
                      onSelect={() => { if (!isColumnBusy) { setColumnToDelete(column); setDeleteColumnDialogOpen(true); } }}
                      className="text-xs text-destructive focus:text-destructive"
                    >
                      Delete
                    </DropdownMenuItem>
                  )}
                  {isStringLike && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger className="text-xs">
                          <Filter className={cn('mr-1.5 h-3.5 w-3.5', isFiltered && 'text-primary')} />
                          {isFiltered ? 'Edit Filter' : 'Filter'}
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="w-56 p-0">
                          <ColumnFilterForm
                            column={column}
                            currentOp={isFiltered && activeFilterParts ? activeFilterParts.op : 'contains'}
                            currentValue={isFiltered && activeFilterParts ? activeFilterParts.value : ''}
                            onApply={applyFilter}
                            onClear={clearFilter}
                          />
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {/* Active filter badge */}
            {isFiltered && (
              <button
                type="button"
                onClick={() => clearFilter(column)}
                className="inline-flex h-5 items-center gap-0.5 rounded-full bg-primary/10 px-1.5 text-[10px] font-medium text-primary hover:bg-primary/20"
                aria-label={`Clear filter on ${column}`}
              >
                <Filter className="h-2.5 w-2.5" />
                <X className="h-2.5 w-2.5" />
              </button>
            )}
          </div>
        );
      },
      cell: ({ getValue }) => {
        const cellValue = getValue();
        const displayValue = cellValue == null ? '' : String(cellValue);
        return <span className="block truncate" title={displayValue}>{displayValue}</span>;
      },
      meta: {
        headerClassName: 'whitespace-nowrap border-r border-border/70 px-2 py-2 text-left',
        headerMaxWidth: isWideColumn ? (isCollapsedColumn ? COLLAPSED_COLUMN_MAX_WIDTH : EXPANDED_COLUMN_MAX_WIDTH) : undefined,
        cellClassName: 'whitespace-nowrap border-r border-border/60 px-2 py-1.5 text-sm text-foreground',
        cellMaxWidth: isWideColumn ? (isCollapsedColumn ? COLLAPSED_COLUMN_MAX_WIDTH : EXPANDED_COLUMN_MAX_WIDTH) : undefined,
      },
    } satisfies ColumnDef<DataRow, unknown>;
  });

  // TanStack Table instance (server-side)
  const pageIndex = pagination ? pagination.page - 1 : 0;
  const pageSize = pagination?.page_size ?? 20;
  const totalRows = rowCount ?? pagination?.total_rows ?? 0;

  const handlePaginationChange = (updater: TanstackPaginationState | ((prev: TanstackPaginationState) => TanstackPaginationState)) => {
    const current = { pageIndex, pageSize };
    const next = typeof updater === 'function' ? updater(current) : updater;
    if (next.pageSize !== pageSize) onPageSizeChange?.(next.pageSize);
    if (next.pageIndex !== pageIndex) onPageChange?.(next.pageIndex + 1);
  };

  const handleSortingChangeInternal = (updater: SortingState | ((prev: SortingState) => SortingState)) => {
    const next = typeof updater === 'function' ? updater(sorting) : updater;
    onSortingChange?.(next);
    onPageChange?.(1);
  };

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

  // Pinned column styles
  const getPinnedStyles = (col: TableColumn<DataRow, unknown>, variant: 'header' | 'cell'): React.CSSProperties | undefined => {
    const pinState = col.getIsPinned();
    if (!pinState) return undefined;
    const style: React.CSSProperties = {
      position: 'sticky',
      zIndex: variant === 'header' ? 30 : 5,
    };
    if (variant === 'header') style.top = 0;
    if (pinState === 'left') {
      style.left = `${col.getStart('left')}px`;
      style.boxShadow = variant === 'header' ? '2px 0 0 -1px rgba(15, 23, 42, 0.12)' : '2px 0 0 -1px rgba(15, 23, 42, 0.08)';
    } else if (pinState === 'right') {
      style.right = `${col.getStart('right')}px`;
      style.boxShadow = variant === 'header' ? '-2px 0 0 -1px rgba(15, 23, 42, 0.12)' : '-2px 0 0 -1px rgba(15, 23, 42, 0.08)';
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
                        className={cn(meta?.headerClassName, 'h-8 px-1 py-1 last:border-r-0', header.column.getIsPinned() ? 'bg-muted shadow-sm' : 'bg-muted')}
                        style={{
                          ...(meta?.headerMinWidth ? { minWidth: `${meta.headerMinWidth}px` } : {}),
                          ...(meta?.headerMaxWidth !== undefined ? { maxWidth: `${meta.headerMaxWidth}px`, width: `${meta.headerMaxWidth}px`, overflow: 'hidden' } : {}),
                          ...(meta?.headerMinWidth || meta?.headerMaxWidth !== undefined ? { transition: 'max-width 200ms ease, width 200ms ease, min-width 200ms ease' } : {}),
                          ...getPinnedStyles(header.column, 'header'),
                        }}
                      >
                        {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
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
                    const detailTextColumn = documentColumn && Object.prototype.hasOwnProperty.call(row.original, documentColumn) ? documentColumn : undefined;
                    openRowDetail({ record: { ...row.original }, textColumn: detailTextColumn });
                  }}
                >
                  {row.getVisibleCells().map((cell) => {
                    const meta = cell.column.columnDef.meta;
                    return (
                      <TableCell
                        key={cell.id}
                        className={cn(meta?.cellClassName, 'last:border-r-0', cell.column.getIsPinned() ? 'bg-white' : undefined)}
                        style={{
                          ...(meta?.cellMinWidth ? { minWidth: `${meta.cellMinWidth}px` } : {}),
                          ...(meta?.cellMaxWidth !== undefined ? { maxWidth: `${meta.cellMaxWidth}px`, width: `${meta.cellMaxWidth}px`, overflow: 'hidden' } : {}),
                          ...(meta?.cellMinWidth || meta?.cellMaxWidth !== undefined ? { transition: 'max-width 200ms ease, width 200ms ease, min-width 200ms ease' } : {}),
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
                  <TableCell colSpan={visibleColumnCount} className="px-4 py-6 text-center text-sm text-muted-foreground">
                    No rows to display
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </ScrollArea>
        <ServerTablePagination table={tableInstance} />
      </div>

      <DatetimeFormatPanel
        open={datetimeModal.isOpen}
        onClose={() => setDatetimeModal({ isOpen: false, column: '', targetType: '' })}
        onConfirm={handleDatetimeFormatConfirm}
        columnName={datetimeModal.column}
        sampleValues={sanitizedData.slice(0, 25).map((row) => {
          const v = row[datetimeModal.column];
          return v == null ? '' : String(v);
        }).filter(Boolean)}
      />

      <ConfirmDialog
        open={deleteColumnDialogOpen}
        onOpenChange={setDeleteColumnDialogOpen}
        title="Delete Column"
        description={`Are you sure you want to delete column "${columnToDelete}"? This operation cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
        variant="destructive"
        onConfirm={confirmDeleteColumn}
      />

      <RowDetailPanel open={detailOpen} onOpenChange={setDetailOpen} payload={detailPayload} />
    </>
  );
}
