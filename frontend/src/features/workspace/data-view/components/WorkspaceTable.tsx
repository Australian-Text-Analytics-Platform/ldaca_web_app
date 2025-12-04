import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Column as TableColumn } from '@tanstack/react-table';
import {
  ColumnDef,
  ColumnPinningState,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { ChevronDown, Expand, Loader2, Minimize, Pin, Settings2 } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { ScrollArea } from '../../../../components/ui/scroll-area';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '../../../../components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../../components/ui/table';
import { DatetimeFormatPanel } from '../../../../components/panels/DatetimeFormatPanel';
import { ConfirmDialog } from '../../../../components/ui/confirm-dialog';
import { TablePaginationControls } from './TablePaginationControls';
import type { DataRow, PaginationInfo } from '../types';
import {
  DATA_TYPES,
  extractColumnTypes,
  getTypeDisplayName,
  normalizeTypeName,
} from '../services/schemaMutations';

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

const WIDE_COLUMN_THRESHOLD = 120;
const COLLAPSED_COLUMN_MAX_WIDTH = 320;
const EXPANDED_COLUMN_MAX_WIDTH = 960;
const WIDE_COLUMN_SAMPLE_LIMIT = 25;

export interface WorkspaceTableProps {
  data: DataRow[];
  loading?: boolean;
  workspaceId?: string;
  nodeId?: string;
  onCast?: (column: string, targetType: string, format?: string) => Promise<void>;
  onRenameColumn?: (column: string, nextName: string) => Promise<void>;
  onDeleteColumn?: (column: string) => Promise<void>;
  onRefreshSchema?: () => Promise<unknown>;
  pagination?: PaginationInfo | null;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
}

export function WorkspaceTable({
  data,
  loading = false,
  workspaceId,
  nodeId,
  onCast,
  onRenameColumn,
  onDeleteColumn,
  onRefreshSchema,
  pagination,
  onPageChange,
  onPageSizeChange,
}: WorkspaceTableProps) {
  const [columnTypes, setColumnTypes] = useState<Record<string, string>>({});
  const [loadingCast, setLoadingCast] = useState<Record<string, boolean>>({});
  const [datetimeModal, setDatetimeModal] = useState<{
    isOpen: boolean;
    column: string;
    targetType: string;
  }>({
    isOpen: false,
    column: '',
    targetType: '',
  });
  const [columnActionLoading, setColumnActionLoading] = useState<Record<string, boolean>>({});
  const [renameState, setRenameState] = useState<{ column: string; value: string } | null>(null);
  const renameInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [columnPinning, setColumnPinning] = useState<ColumnPinningState>({ left: [] });
  const [expandedColumns, setExpandedColumns] = useState<Record<string, boolean>>({});
  const [deleteColumnDialogOpen, setDeleteColumnDialogOpen] = useState(false);
  const [columnToDelete, setColumnToDelete] = useState<string | null>(null);

  const debugEnabled = useMemo(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    try {
      return window.localStorage.getItem('debugDataTable') === '1';
    } catch (error) {
      console.debug('WorkspaceTable: unable to read debug flag', error);
      return false;
    }
  }, []);

  const applySchema = useCallback(
    (schema: unknown) => {
      const mapping = extractColumnTypes(schema as any);
      if (debugEnabled) {
        console.debug('WorkspaceTable: loaded column types', mapping);
      }
      setColumnTypes(mapping);
      return mapping;
    },
    [debugEnabled]
  );

  useEffect(() => {
    if (!workspaceId || !nodeId || !onRefreshSchema) {
      return;
    }

    let cancelled = false;
    onRefreshSchema()
      .then((schema) => {
        if (!cancelled) {
          applySchema(schema);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.error('WorkspaceTable: failed to refresh schema', error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [workspaceId, nodeId, onRefreshSchema, applySchema]);

  useEffect(() => {
    if (!renameState) {
      return;
    }
    const input = renameInputRefs.current[renameState.column];
    if (input) {
      setTimeout(() => {
        input.focus();
        input.select();
      }, 10);
    }
  }, [renameState]);

  useEffect(() => {
    if (!debugEnabled) {
      return;
    }
    console.debug('WorkspaceTable: data received', { rowCount: data.length, loading });
  }, [data, loading, debugEnabled]);

  const sanitizedData = useMemo<DataRow[]>(() => (Array.isArray(data) ? data : []), [data]);

  const columns = useMemo<string[]>(() => {
    const firstRow = sanitizedData.find((row) => row && typeof row === 'object');
    if (firstRow) {
      return Object.keys(firstRow);
    }
    return Object.keys(columnTypes);
  }, [sanitizedData, columnTypes]);

  const wideColumns = useMemo(() => {
    const sampleRows = sanitizedData.slice(0, WIDE_COLUMN_SAMPLE_LIMIT);
    const result = new Set<string>();

    columns.forEach((column) => {
      let maxContentLength = column.length;
      for (const row of sampleRows) {
        if (!row || typeof row !== 'object') {
          continue;
        }
        const rawValue = row[column];
        if (rawValue === null || rawValue === undefined) {
          continue;
        }
        const displayValue = typeof rawValue === 'string' ? rawValue : String(rawValue);
        maxContentLength = Math.max(maxContentLength, displayValue.length);
        if (maxContentLength > WIDE_COLUMN_THRESHOLD) {
          result.add(column);
          break;
        }
      }
    });

    return result;
  }, [columns, sanitizedData]);

  const toggleColumnWidth = useCallback((columnId: string) => {
    setExpandedColumns((prev) => {
      if (prev[columnId]) {
        const { [columnId]: _removed, ...rest } = prev;
        return rest;
      }
      return { ...prev, [columnId]: true };
    });
  }, []);

  const performCast = useCallback(
    async (column: string, targetType: string, format?: string) => {
      if (!onCast) {
        return;
      }

      setLoadingCast((prev) => ({ ...prev, [column]: true }));

      try {
        await onCast(column, targetType, format);
        if (!onRefreshSchema) {
          return;
        }
        const schema = await onRefreshSchema();
        applySchema(schema);
      } catch (error) {
        console.error('WorkspaceTable: cast error', error);
        const message = error instanceof Error ? error.message : String(error);
        try {
          alert(`Failed to convert column "${column}" to ${targetType}: ${message}`);
        } catch {
          // ignore alert failures
        }
      } finally {
        setLoadingCast((prev) => ({ ...prev, [column]: false }));
      }
    },
    [onCast, onRefreshSchema, applySchema]
  );

  const handleTypeChange = useCallback(
    (column: string, newType: string) => {
      if (!onCast) {
        return;
      }

      const currentType = normalizeTypeName(columnTypes[column] ?? 'string');
      const targetType = newType.toLowerCase();

      if (targetType === currentType.toLowerCase()) {
        return;
      }

      const isStringToDatetime =
        targetType === 'datetime' && (currentType === 'string' || currentType.includes('utf8'));

      if (isStringToDatetime) {
        setDatetimeModal({ isOpen: true, column, targetType: newType });
        return;
      }

      void performCast(column, newType);
    },
    [onCast, columnTypes, performCast]
  );

  const handleDatetimeFormatConfirm = useCallback(
    (format?: string) => {
      const { column, targetType } = datetimeModal;
      setDatetimeModal({ isOpen: false, column: '', targetType: '' });
      if (column && targetType) {
        void performCast(column, targetType, format);
      }
    },
    [datetimeModal, performCast]
  );

  const beginRename = useCallback((column: string) => {
    setRenameState({ column, value: column });
    setTimeout(() => {
      const input = renameInputRefs.current[column];
      if (input) {
        input.focus();
        input.select();
      }
    }, 20);
  }, []);

  const updateRenameDraft = useCallback((column: string, nextValue: string) => {
    setRenameState((prev) => (prev && prev.column === column ? { column, value: nextValue } : prev));
  }, []);

  const setColumnBusy = useCallback((column: string, active: boolean) => {
    setColumnActionLoading((prev) => {
      if (active) {
        if (prev[column]) {
          return prev;
        }
        return { ...prev, [column]: true };
      }
      if (!(column in prev)) {
        return prev;
      }
      const next = { ...prev };
      delete next[column];
      return next;
    });
  }, []);

  const submitRename = useCallback(
    async (column: string, value: string) => {
      if (!renameState || renameState.column !== column) {
        return;
      }
      if (!onRenameColumn) {
        setRenameState(null);
        return;
      }

      const trimmed = value.trim();
      if (!trimmed) {
        try {
          alert('Column name cannot be empty.');
        } catch {
          /* ignore */
        }
        return;
      }

      if (trimmed === column) {
        setRenameState(null);
        return;
      }

      const nameConflict = columns.some((existing) => existing !== column && existing === trimmed);
      if (nameConflict) {
        try {
          alert(`A column named "${trimmed}" already exists.`);
        } catch {
          /* ignore */
        }
        return;
      }

      setColumnBusy(column, true);
      try {
        await onRenameColumn(column, trimmed);
        if (onRefreshSchema) {
          const schema = await onRefreshSchema();
          applySchema(schema);
        }
        setRenameState(null);
      } catch (error) {
        console.error('WorkspaceTable: rename column error', error);
        const message = error instanceof Error ? error.message : String(error);
        try {
          alert(`Failed to rename column "${column}": ${message}`);
        } catch {
          /* ignore */
        }
      } finally {
        setColumnBusy(column, false);
      }
    },
    [renameState, onRenameColumn, columns, onRefreshSchema, applySchema, setColumnBusy]
  );

  const requestDeleteColumn = useCallback(
    async (column: string) => {
      if (!onDeleteColumn) {
        return;
      }
      setColumnToDelete(column);
      setDeleteColumnDialogOpen(true);
    },
    [onDeleteColumn]
  );

  const confirmDeleteColumn = useCallback(async () => {
    if (!columnToDelete || !onDeleteColumn) {
      return;
    }

    const column = columnToDelete;
    setDeleteColumnDialogOpen(false);
    setColumnToDelete(null);

    setColumnBusy(column, true);
    try {
      await onDeleteColumn(column);
      if (onRefreshSchema) {
        const schema = await onRefreshSchema();
        applySchema(schema);
      } else {
        setColumnTypes((prev) => {
          if (!(column in prev)) {
            return prev;
          }
          const next = { ...prev };
          delete next[column];
          return next;
        });
      }
      if (renameState?.column === column) {
        setRenameState(null);
      }
    } catch (error) {
      console.error('WorkspaceTable: delete column error', error);
      const message = error instanceof Error ? error.message : String(error);
      try {
        alert(`Failed to delete column "${column}": ${message}`);
      } catch {
        /* ignore */
      }
    } finally {
      setColumnBusy(column, false);
    }
  }, [columnToDelete, onDeleteColumn, onRefreshSchema, applySchema, renameState, setColumnBusy]);

  const columnDefs = useMemo<ColumnDef<DataRow, unknown>[]>(() => {
    return columns.map((column) => {
      const currentType = normalizeTypeName(columnTypes[column] ?? 'string');
      const isColumnLoading = Boolean(loadingCast[column]);
      const isColumnMutating = Boolean(columnActionLoading[column]);
      const isColumnBusy = isColumnLoading || isColumnMutating;
      const displayLabel = getTypeDisplayName(currentType);
      const availableTypes = [
        { value: currentType, label: displayLabel },
        ...DATA_TYPES.filter((type) => type.value !== currentType),
      ];
      const isRenaming = renameState?.column === column;
      const renameDraftValue = isRenaming ? renameState.value : column;
      const canRename = Boolean(onRenameColumn);
      const canDelete = Boolean(onDeleteColumn);
      const isWideColumn = wideColumns.has(column);
      const isExpandedColumn = expandedColumns[column] === true;
      const isCollapsedColumn = isWideColumn && !isExpandedColumn;

      return {
        id: column,
        accessorFn: (row) => row?.[column],
        header: ({ column: columnInstance }) => {
          const isPinnedLeft = columnInstance.getIsPinned() === 'left';
          return (
            <div className="flex min-w-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => columnInstance.pin(isPinnedLeft ? false : 'left')}
                className={cn(
                  'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-transparent text-muted-foreground transition-colors hover:bg-muted-foreground/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  isPinnedLeft && 'text-primary'
                )}
                aria-pressed={isPinnedLeft}
                aria-label={isPinnedLeft ? `Unpin column ${column}` : `Pin column ${column} to the left`}
              >
                <Pin className="h-3.5 w-3.5" fill={isPinnedLeft ? 'currentColor' : 'none'} />
              </button>
              {isRenaming ? (
                <Input
                  ref={(element) => {
                    if (element) {
                      renameInputRefs.current[column] = element;
                    } else {
                      delete renameInputRefs.current[column];
                    }
                  }}
                  value={renameDraftValue}
                  disabled={isColumnBusy}
                  onChange={(event) => updateRenameDraft(column, event.target.value)}
                  onBlur={() => {
                    if (!isColumnBusy) {
                      void submitRename(column, renameDraftValue);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      if (!isColumnBusy) {
                        void submitRename(column, renameDraftValue);
                      }
                    } else if (event.key === 'Escape') {
                      setRenameState(null);
                    }
                  }}
                  className="h-7 w-40 truncate text-xs"
                  aria-label={`Rename column ${column}`}
                />
              ) : (
                <div className="min-w-0">
                  {canRename ? (
                    <button
                      type="button"
                      className="block max-w-[160px] truncate text-left text-xs font-medium text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      onClick={() => {
                        if (!isColumnBusy) {
                          beginRename(column);
                        }
                      }}
                      disabled={isColumnBusy}
                      title={column}
                    >
                      {column}
                    </button>
                  ) : (
                    <span className="block max-w-[160px] truncate text-xs font-medium text-foreground" title={column}>
                      {column}
                    </span>
                  )}
                </div>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isColumnBusy || !onCast}
                    className={cn(
                      'h-7 min-w-[104px] justify-between gap-2 px-2 text-xs font-medium',
                      isColumnBusy && 'cursor-progress opacity-80'
                    )}
                    aria-label={`Change data type for column ${column}`}
                  >
                    <span className="truncate">{displayLabel}</span>
                    {isColumnBusy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-40 p-1">
                  <DropdownMenuRadioGroup
                    value={currentType}
                    onValueChange={(value) => {
                      if (!isColumnBusy) {
                        handleTypeChange(column, value);
                      }
                    }}
                  >
                    {availableTypes.map((type) => (
                      <DropdownMenuRadioItem key={type.value} value={type.value} className="text-xs">
                        {type.label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
              {isWideColumn ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => toggleColumnWidth(column)}
                  className="h-7 w-7 shrink-0 text-muted-foreground hover:text-primary"
                  aria-label={isCollapsedColumn ? `Expand column ${column}` : `Collapse column ${column}`}
                >
                  {isCollapsedColumn ? <Expand className="h-3.5 w-3.5" /> : <Minimize className="h-3.5 w-3.5" />}
                </Button>
              ) : null}
              {(canRename || canDelete) && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={isColumnBusy}
                      className={cn(
                        'h-7 w-7 shrink-0 text-muted-foreground hover:text-primary',
                        isColumnBusy && 'cursor-progress opacity-80'
                      )}
                      aria-label={`Column settings for ${column}`}
                    >
                      {isColumnBusy ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Settings2 className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-40 p-1">
                    {canRename && (
                      <DropdownMenuItem
                        disabled={isColumnBusy}
                        onSelect={() => {
                          if (isColumnBusy) {
                            return;
                          }
                          beginRename(column);
                        }}
                        className="text-xs"
                      >
                        Rename
                      </DropdownMenuItem>
                    )}
                    {canDelete && (
                      <DropdownMenuItem
                        disabled={isColumnBusy}
                        onSelect={() => {
                          if (isColumnBusy) {
                            return;
                          }
                          void requestDeleteColumn(column);
                        }}
                        className="text-xs text-destructive focus:text-destructive"
                      >
                        Delete
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          );
        },
        cell: ({ getValue }) => {
          const cellValue = getValue();
          const displayValue = cellValue === null || cellValue === undefined ? '' : String(cellValue);
          return (
            <span className="block truncate" title={displayValue}>
              {displayValue}
            </span>
          );
        },
        meta: {
          headerClassName: 'whitespace-nowrap border-r border-border/70 px-4 py-3 text-left',
          headerMinWidth: 250,
          headerMaxWidth: isWideColumn
            ? isCollapsedColumn
              ? COLLAPSED_COLUMN_MAX_WIDTH
              : EXPANDED_COLUMN_MAX_WIDTH
            : undefined,
          cellClassName: 'whitespace-nowrap border-r border-border/60 px-4 py-3 text-sm text-foreground',
          cellMinWidth: 200,
          cellMaxWidth: isWideColumn
            ? isCollapsedColumn
              ? COLLAPSED_COLUMN_MAX_WIDTH
              : EXPANDED_COLUMN_MAX_WIDTH
            : undefined,
        },
      } satisfies ColumnDef<DataRow, unknown>;
    });
  }, [
    columns,
    columnTypes,
    loadingCast,
    columnActionLoading,
    renameState,
    onRenameColumn,
    onDeleteColumn,
    onCast,
    wideColumns,
    expandedColumns,
    toggleColumnWidth,
    handleTypeChange,
    updateRenameDraft,
    submitRename,
    beginRename,
    requestDeleteColumn,
  ]);

  const getPinnedStyles = useCallback(
    (column: TableColumn<DataRow, unknown>, variant: 'header' | 'cell'): React.CSSProperties | undefined => {
      const pinState = column.getIsPinned();
      if (!pinState) {
        return undefined;
      }

      const style: React.CSSProperties = {
        position: 'sticky',
        zIndex: variant === 'header' ? 30 : 5,
      };

      if (variant === 'header') {
        style.top = 0;
      }

      if (pinState === 'left') {
        style.left = `${column.getStart('left')}px`;
        style.boxShadow =
          variant === 'header'
            ? '2px 0 0 -1px rgba(15, 23, 42, 0.12)'
            : '2px 0 0 -1px rgba(15, 23, 42, 0.08)';
      } else if (pinState === 'right') {
        style.right = `${column.getStart('right')}px`;
        style.boxShadow =
          variant === 'header'
            ? '-2px 0 0 -1px rgba(15, 23, 42, 0.12)'
            : '-2px 0 0 -1px rgba(15, 23, 42, 0.08)';
      }

      return style;
    },
    []
  );

  const tableInstance = useReactTable({
    data: sanitizedData,
    columns: columnDefs,
    getCoreRowModel: getCoreRowModel(),
    debugTable: debugEnabled,
    state: {
      columnPinning,
    },
    onColumnPinningChange: setColumnPinning,
  });

  const tableRows = tableInstance.getRowModel().rows;
  const visibleColumnCount = Math.max(tableInstance.getVisibleLeafColumns().length, 1);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex items-center space-x-3">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <span className="text-sm font-medium text-muted-foreground">Loading data…</span>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex h-full w-full flex-col min-h-0">
        <ScrollArea
          type="always"
          scrollbars="both"
          className="flex-1 rounded-t-lg border border-border shadow-sm bg-white"
          style={{ scrollbarGutter: 'stable both-edges' }}
        >
          <Table disableContainer>
            <TableHeader className="sticky top-0 z-20 bg-muted">
              {tableInstance.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => {
                    const meta = header.column.columnDef.meta;
                    return (
                      <TableHead
                        key={header.id}
                        className={cn(
                          meta?.headerClassName,
                          'last:border-r-0',
                          header.column.getIsPinned()
                            ? 'bg-muted shadow-sm ring-1 ring-primary/20'
                            : 'bg-muted'
                        )}
                        style={{
                          ...(meta?.headerMinWidth ? { minWidth: `${meta.headerMinWidth}px` } : {}),
                          ...(meta?.headerMaxWidth !== undefined
                            ? {
                                maxWidth: `${meta.headerMaxWidth}px`,
                                width: `${meta.headerMaxWidth}px`,
                                overflow: 'hidden',
                              }
                            : {}),
                          ...(meta?.headerMinWidth || meta?.headerMaxWidth !== undefined
                            ? {
                                transition: 'max-width 200ms ease, width 200ms ease, min-width 200ms ease',
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
                <TableRow key={row.id} className="transition-colors duration-150 hover:bg-muted/40">
                  {row.getVisibleCells().map((cell) => {
                    const meta = cell.column.columnDef.meta;
                    return (
                      <TableCell
                        key={cell.id}
                        className={cn(
                          meta?.cellClassName,
                          'last:border-r-0',
                          cell.column.getIsPinned()
                            ? 'bg-white ring-1 ring-inset ring-primary/10'
                            : undefined
                        )}
                        style={{
                          ...(meta?.cellMinWidth ? { minWidth: `${meta.cellMinWidth}px` } : {}),
                          ...(meta?.cellMaxWidth !== undefined
                            ? {
                                maxWidth: `${meta.cellMaxWidth}px`,
                                width: `${meta.cellMaxWidth}px`,
                                overflow: 'hidden',
                              }
                            : {}),
                          ...(meta?.cellMinWidth || meta?.cellMaxWidth !== undefined
                            ? {
                                transition: 'max-width 200ms ease, width 200ms ease, min-width 200ms ease',
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
                  <TableCell colSpan={visibleColumnCount} className="px-4 py-6 text-center text-sm text-muted-foreground">
                    No rows to display
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </ScrollArea>
        <TablePaginationControls
          pagination={pagination}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
        />
      </div>

      <DatetimeFormatPanel
        open={datetimeModal.isOpen}
        onClose={() => setDatetimeModal({ isOpen: false, column: '', targetType: '' })}
        onConfirm={handleDatetimeFormatConfirm}
        columnName={datetimeModal.column}
        sampleValues={sanitizedData
          .slice(0, 25)
          .map((row) => {
            const value = row[datetimeModal.column];
            return value === null || value === undefined ? '' : String(value);
          })
          .filter(Boolean)}
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
    </>
  );
}
