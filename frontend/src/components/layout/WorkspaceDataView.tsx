import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Loader2, Settings2, X } from 'lucide-react';

import { useWorkspaceActions } from '../../hooks/useWorkspaceActions';
import { useWorkspaceData } from '../../hooks/useWorkspaceData';
import { useWorkspaceSelection } from '../../hooks/useWorkspaceSelection';
import { useWorkspaceStatus } from '../../hooks/useWorkspaceStatus';
import { NodeSchemaResponse } from '../../types';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { ScrollArea } from '../ui/scroll-area';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '../ui/Pagination';
import { Skeleton } from '../ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/table';
import { DatetimeFormatPanel } from '../panels/DatetimeFormatPanel';

type DataRow = Record<string, unknown>;

interface PaginationInfo {
  page: number;
  page_size: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
  [key: string]: unknown;
}

interface WorkspaceTableProps {
  data: DataRow[];
  loading?: boolean;
  workspaceId?: string;
  nodeId?: string;
  onCast?: (column: string, targetType: string, format?: string) => Promise<void>;
  onRenameColumn?: (column: string, nextName: string) => Promise<void>;
  onDeleteColumn?: (column: string) => Promise<void>;
  onRefreshSchema?: () => Promise<NodeSchemaResponse | null | undefined>;
  pagination?: PaginationInfo | null;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
}

type PaginationRangeItem = number | 'dots';

interface LegacySchemaEntry {
  name: string;
  js_type?: string;
}

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

const DATA_TYPES = [
  { value: 'string', label: 'string' },
  { value: 'categorical', label: 'categorical' },
  { value: 'integer', label: 'integer' },
  { value: 'float', label: 'float' },
  { value: 'boolean', label: 'boolean' },
  { value: 'datetime', label: 'datetime' },
  { value: 'array', label: 'array' },
] as const;

const buildPaginationRange = (current: number, total: number): PaginationRangeItem[] => {
  const normalizedTotal = Math.max(total, 1);
  const output: PaginationRangeItem[] = [];
  let previous: number | null = null;

  for (let page = 1; page <= normalizedTotal; page++) {
    const isBoundary = page === 1 || page === normalizedTotal;
    const isNearCurrent = Math.abs(page - current) <= 1;
    const shouldShow = normalizedTotal <= 5 || isBoundary || isNearCurrent;

    if (!shouldShow) {
      continue;
    }

    if (previous !== null) {
      const gap = page - previous;
      if (gap === 2) {
        output.push(previous + 1);
      } else if (gap > 2) {
        output.push('dots');
      }
    }

    output.push(page);
    previous = page;
  }

  return output;
};

const isLegacySchemaArray = (value: unknown): value is LegacySchemaEntry[] =>
  Array.isArray(value) && value.every((entry) => entry && typeof entry.name === 'string');

const extractColumnTypes = (schema: NodeSchemaResponse | null | undefined): Record<string, string> => {
  if (!schema) {
    return {};
  }

  const schemaValue = schema.schema as unknown;
  if (isLegacySchemaArray(schemaValue)) {
    return Object.fromEntries(schemaValue.map(({ name, js_type }) => [name, js_type ?? 'string']));
  }

  if (schema.column_types && Object.keys(schema.column_types).length > 0) {
    return schema.column_types;
  }

  if (schema.schema && typeof schema.schema === 'object') {
    return schema.schema as Record<string, string>;
  }

  return {};
};

const WorkspaceTable: React.FC<WorkspaceTableProps> = ({
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
}) => {
  const [columnTypes, setColumnTypes] = useState<Record<string, string>>({});
  const [loadingCast, setLoadingCast] = useState<Record<string, boolean>>({});
  const [datetimeModal, setDatetimeModal] = useState<{ isOpen: boolean; column: string; targetType: string }>({
    isOpen: false,
    column: '',
    targetType: '',
  });
  const [columnActionLoading, setColumnActionLoading] = useState<Record<string, boolean>>({});
  const [renameState, setRenameState] = useState<{ column: string; value: string } | null>(null);
  const renameInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

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
    (schema: NodeSchemaResponse | null | undefined) => {
      const mapping = extractColumnTypes(schema);
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
      // Use a longer delay to ensure the dropdown has closed and input is fully rendered
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

  const normalizeTypeName = useCallback((type: string): string => {
    const lowercaseType = type.toLowerCase();
    if (lowercaseType.includes('utf8') || lowercaseType.includes('string')) return 'string';
    if (lowercaseType.includes('categorical') || lowercaseType.includes('category')) return 'categorical';
    if (lowercaseType.includes('int')) return 'integer';
    if (lowercaseType.includes('float') || lowercaseType.includes('double')) return 'float';
    if (lowercaseType.includes('bool')) return 'boolean';
    if (lowercaseType.includes('date')) return 'datetime';
    if (lowercaseType.includes('datetime')) return 'datetime';
    if (lowercaseType.includes('list') || lowercaseType.includes('array')) return 'array';
    return type;
  }, []);

  const getTypeDisplayName = useCallback((type: string): string => {
    const dataType = DATA_TYPES.find((entry) => entry.value === type);
    return dataType ? dataType.label : type;
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
    [onCast, columnTypes, normalizeTypeName, performCast]
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
    // Additional focus management after state update
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

      const confirmation =
        typeof window === 'undefined'
          ? true
          : window.confirm(`Delete column "${column}"? This operation cannot be undone.`);
      if (!confirmation) {
        return;
      }

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
    },
    [onDeleteColumn, onRefreshSchema, applySchema, renameState, setColumnBusy]
  );

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

  const renderPaginationControls = () => {
    if (!pagination || !onPageChange || !onPageSizeChange) {
      return null;
    }

    const { page, page_size, total_pages, has_next, has_prev } = pagination;
    const safeTotalPages = Math.max(total_pages ?? 1, 1);
    const pageSizeOptions = Array.from(new Set([...PAGE_SIZE_OPTIONS, page_size])).sort((a, b) => a - b);
    const paginationRange = buildPaginationRange(page, safeTotalPages);

    const prevDisabled = !has_prev;
    const nextDisabled = !has_next;

    return (
      <div className="flex flex-col gap-3 border-t border-border bg-muted/40 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>Rows per page</span>
          <select
            value={page_size}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            className="h-9 rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {pageSizeOptions.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </div>

        <Pagination className="w-full justify-center sm:w-auto sm:justify-end">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                href="#"
                onClick={(event) => {
                  event.preventDefault();
                  if (!prevDisabled) {
                    onPageChange(page - 1);
                  }
                }}
                className={cn(prevDisabled && 'pointer-events-none opacity-50')}
                aria-disabled={prevDisabled}
                tabIndex={prevDisabled ? -1 : undefined}
              />
            </PaginationItem>
            {paginationRange.map((item, index) => (
              <PaginationItem key={`${item}-${index}`}>
                {item === 'dots' ? (
                  <PaginationEllipsis />
                ) : (
                  <PaginationLink
                    href="#"
                    onClick={(event) => {
                      event.preventDefault();
                      if (item !== page) {
                        onPageChange(item);
                      }
                    }}
                    isActive={item === page}
                    size="default"
                  >
                    {item}
                  </PaginationLink>
                )}
              </PaginationItem>
            ))}
            <PaginationItem>
              <PaginationNext
                href="#"
                onClick={(event) => {
                  event.preventDefault();
                  if (!nextDisabled) {
                    onPageChange(page + 1);
                  }
                }}
                className={cn(nextDisabled && 'pointer-events-none opacity-50')}
                aria-disabled={nextDisabled}
                tabIndex={nextDisabled ? -1 : undefined}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </div>
    );
  };

  return (
    <>
      <div className="flex h-full w-full flex-col min-h-0">
        <ScrollArea
          type="always"
          scrollbars="both"
          className="flex-1 rounded-t-lg border border-border shadow-sm bg-white"
          style={{ scrollbarGutter: 'stable both-edges' }}
        >
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-muted/40">
              <TableRow>
                {columns.map((column) => {
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

                  return (
                    <TableHead
                      key={column}
                      className="whitespace-nowrap border-r border-border/70 px-4 py-3 text-left last:border-r-0"
                      style={{ minWidth: '250px' }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
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
                          ) : canRename ? (
                            <button
                              type="button"
                              className="max-w-[160px] truncate text-left text-xs font-medium text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
                        <div className="flex items-center gap-1">
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
                                  <DropdownMenuRadioItem
                                    key={type.value}
                                    value={type.value}
                                    className="text-xs"
                                  >
                                    {type.label}
                                  </DropdownMenuRadioItem>
                                ))}
                              </DropdownMenuRadioGroup>
                            </DropdownMenuContent>
                          </DropdownMenu>
                          {(canRename || canDelete) && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  disabled={isColumnBusy}
                                  className={cn(
                                    'h-7 w-7 text-muted-foreground hover:text-primary',
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
                      </div>
                    </TableHead>
                  );
                })}
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-border/60 bg-white">
              {sanitizedData.map((row, rowIndex) => (
                <TableRow key={rowIndex} className="transition-colors duration-150 hover:bg-muted/40">
                  {columns.map((column, columnIndex) => {
                    const cellValue = row[column];
                    const displayValue = cellValue === null || cellValue === undefined ? '' : String(cellValue);
                    return (
                      <TableCell
                        key={`${column}-${columnIndex}`}
                        className="whitespace-nowrap border-r border-border/60 px-4 py-3 text-sm text-foreground last:border-r-0"
                        style={{ minWidth: '200px' }}
                      >
                        {displayValue}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
              {sanitizedData.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={columns.length || 1}
                    className="px-4 py-6 text-center text-sm text-muted-foreground"
                  >
                    No rows to display
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </ScrollArea>
        {renderPaginationControls()}
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
    </>
  );
};

/**
 * Separated data view component focused only on data table rendering
 * This replaces the data table logic from the monolithic WorkspaceView
 */
export const WorkspaceDataView: React.FC = memo(() => {
  const { currentWorkspaceId, nodeData, getNodeShape } = useWorkspaceData();
  const { selectedNode, selectedNodes, selectedNodeIds, handlePageChange, handlePageSizeChange } = useWorkspaceSelection();
  const { castColumn, renameColumn, deleteColumn, refreshNodeSchema, selectNodes, toggleNodeSelection } = useWorkspaceActions();
  const { isLoading } = useWorkspaceStatus();

  const multiSelectedNodes = useMemo(() => selectedNodes.filter(Boolean), [selectedNodes]);
  const activeNodeId = selectedNode?.id ?? (multiSelectedNodes[0]?.id ?? null);
  const shouldShowTabs = multiSelectedNodes.length > 1;
  const [tabOrder, setTabOrder] = useState<string[]>(() => [...selectedNodeIds]);
  const nodeById = useMemo(() => {
    const map = new Map<string, (typeof multiSelectedNodes)[number]>();
    multiSelectedNodes.forEach((node) => {
      if (node?.id) {
        map.set(node.id, node);
      }
    });
    return map;
  }, [multiSelectedNodes]);

  useEffect(() => {
    setTabOrder((current) => {
      const filtered = current.filter((id) => selectedNodeIds.includes(id));
      const additions = selectedNodeIds.filter((id) => !filtered.includes(id));
      if (
        filtered.length === current.length &&
        additions.length === 0 &&
        current.length === selectedNodeIds.length
      ) {
        return current;
      }
      return [...filtered, ...additions];
    });
  }, [selectedNodeIds]);

  const displayTabIds = useMemo(
    () => (shouldShowTabs ? tabOrder.filter((id) => nodeById.has(id)) : []),
    [shouldShowTabs, tabOrder, nodeById]
  );

  const activeTabIndex = useMemo(
    () => displayTabIds.findIndex((id) => id === activeNodeId),
    [activeNodeId, displayTabIds]
  );
  const tabPosition = activeTabIndex >= 0 ? activeTabIndex + 1 : displayTabIds.length > 0 ? 1 : 0;

  const handleTabChange = useCallback(
    (nodeId: string) => {
      if (!nodeId || nodeId === activeNodeId || !selectedNodeIds.includes(nodeId)) {
        return;
      }

      const reordered = [nodeId, ...selectedNodeIds.filter((id) => id !== nodeId)];
      selectNodes(reordered);
    },
    [activeNodeId, selectNodes, selectedNodeIds]
  );

  const handleTabClose = useCallback(
    (nodeId: string) => {
      if (!nodeId) {
        return;
      }
      setTabOrder((current) => current.filter((id) => id !== nodeId));
      toggleNodeSelection(nodeId);
    },
    [setTabOrder, toggleNodeSelection]
  );

  const [actualShape, setActualShape] = useState<[number, number] | null>(null);
  const [isLoadingShape, setIsLoadingShape] = useState(false);

  // Fetch actual shape when selectedNode changes and has null shape
  useEffect(() => {
    if (selectedNode && selectedNode.data?.shape?.[0] === null && getNodeShape) {
      setIsLoadingShape(true);
      getNodeShape(selectedNode.id)
        .then((shapeData) => {
          if (shapeData && shapeData.shape) {
            setActualShape(shapeData.shape as [number, number]);
          }
        })
        .catch((error) => {
          console.error('Failed to fetch actual shape:', error);
        })
        .finally(() => {
          setIsLoadingShape(false);
        });
    } else {
      setActualShape(null);
      setIsLoadingShape(false);
    }
  }, [selectedNode, getNodeShape]); // Now safe with stable getNodeShape

  // Helper function to get display shape
  const getDisplayShape = (): [number | string, number | string] => {
    if (selectedNode?.data?.shape) {
      const [rows, cols] = selectedNode.data.shape;
      if (rows === null) {
        // If we have fetched the actual shape, use it, otherwise show loading or ?
        if (actualShape) {
          return actualShape;
        } else if (isLoadingShape) {
          return ['...', cols];
        } else {
          return ['?', cols];
        }
      } else {
        return [rows, cols];
      }
    }
    return ['?', '?'];
  };

  if (isLoading.nodeData) {
    return (
      <div className="space-y-6 p-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Loading node data…</span>
        </div>
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-6 w-20" />
          </div>
          <div className="space-y-3 rounded-lg border border-dashed border-border/50 p-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="grid grid-cols-4 gap-4">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!selectedNode) {
    return (
      <div className="p-6">
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border/50 bg-muted/40 p-6 text-center">
          <svg
            className="h-6 w-6 text-muted-foreground"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
            />
          </svg>
          <h3 className="mt-3 text-sm font-semibold text-foreground">No Node Selected</h3>
          <p className="mt-1 text-xs text-muted-foreground">Select a node from the graph to view its data.</p>
        </div>
      </div>
    );
  }


  // Do not short-circuit on empty data; allow table to render headers only

  return (
    <div className="flex h-full flex-col">
      {shouldShowTabs && (
        <div className="border-b border-border/70 bg-muted/60">
          <div className="flex items-end gap-1 overflow-x-auto px-2 pt-2">
            {displayTabIds.map((nodeId) => {
              const node = nodeById.get(nodeId);
              if (!node) {
                return null;
              }

              const label = node?.data?.nodeName || node?.data?.label || nodeId;
              const isActive = nodeId === activeNodeId;

              return (
                <div
                  key={nodeId}
                  className={cn(
                    'group flex min-w-[140px] max-w-[240px] items-center rounded-t-md border border-border/60 bg-muted/60 pr-1 text-xs font-medium transition-all',
                    isActive
                      ? 'border-b-transparent bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'
                  )}
                >
                  <button
                    type="button"
                    onClick={() => handleTabChange(nodeId)}
                    className={cn(
                      'flex-1 truncate px-3 py-2 text-left',
                      isActive ? 'text-foreground' : 'text-muted-foreground'
                    )}
                    aria-pressed={isActive}
                    aria-selected={isActive}
                  >
                    <span className="block truncate" title={label}>
                      {label}
                    </span>
                    {isActive && (
                      <span className="sr-only"> (active)</span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleTabClose(nodeId)}
                    className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground/70 transition hover:bg-muted-foreground/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`Remove ${label} from selection`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
            <div className="flex-1 border-b border-transparent" aria-hidden />
          </div>
        </div>
      )}

      <div className="flex h-full flex-col">
        {/* Consolidated header with title and metadata in one row */}
        <div className="flex-shrink-0 border-b border-border bg-muted p-2">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-sm font-medium text-gray-700">Data View</h3>
            <span className="text-gray-300">|</span>
            <span className="text-sm font-semibold text-gray-800">
              {selectedNode.data?.nodeName || selectedNode.data?.label || selectedNode.id}
            </span>
            <span className="text-xs text-gray-600">
              Shape:{' '}
              {(() => {
                const [rows, cols] = getDisplayShape();
                return `${rows} × ${cols}`;
              })()}
            </span>
            <span className="text-xs text-gray-600">{nodeData.data.length} rows loaded</span>
            {shouldShowTabs && (
              <span className="text-xs text-gray-500">
                Viewing tab {tabPosition} of {multiSelectedNodes.length}
              </span>
            )}
            {Array.isArray(nodeData.data) && nodeData.data.length === 0 && (
              <span className="text-xs italic text-gray-500" aria-live="polite">
                (empty table)
              </span>
            )}
          </div>
        </div>

        {/* Data table with column type casting */}
        <div className="flex-1 min-h-0">
          <WorkspaceTable
            data={nodeData.data}
            loading={isLoading.nodeData}
            workspaceId={currentWorkspaceId || undefined}
            nodeId={selectedNode.id}
            onCast={async (column: string, targetType: string, format?: string) => {
              await castColumn(selectedNode.id, column, targetType, format);
            }}
            onRenameColumn={async (column: string, nextName: string) => {
              await renameColumn(selectedNode.id, column, nextName);
            }}
            onDeleteColumn={async (column: string) => {
              await deleteColumn(selectedNode.id, column);
            }}
            onRefreshSchema={async () => {
              return await refreshNodeSchema(selectedNode.id);
            }}
            pagination={nodeData.pagination}
            onPageChange={handlePageChange}
            onPageSizeChange={handlePageSizeChange}
          />
        </div>
      </div>
    </div>
  );
});

WorkspaceDataView.displayName = 'WorkspaceDataView';
