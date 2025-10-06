import React, { memo, useState, useEffect, useMemo, useCallback } from 'react';
import { useWorkspaceData } from '../../hooks/useWorkspaceData';
import { useWorkspaceSelection } from '../../hooks/useWorkspaceSelection';
import { useWorkspaceActions } from '../../hooks/useWorkspaceActions';
import { useWorkspaceStatus } from '../../hooks/useWorkspaceStatus';
import { NodeSchemaResponse } from '../../types';
import { Card, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Skeleton } from '../ui/skeleton';
import { Loader2 } from 'lucide-react';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '../ui/pagination';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import DatetimeFormatPanel from '../panels/DatetimeFormatPanel';
import { cn } from '@/lib/utils';
import JoinInterface from '../JoinInterface';

const EmptyStateCard: React.FC<{ title: string; description?: string; icon?: React.ReactNode }> = ({
  title,
  description,
  icon,
}) => (
  <Card className="mx-auto max-w-lg text-center">
    <CardHeader className="flex flex-col items-center space-y-3">
      {icon && (
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          {icon}
        </div>
      )}
      <CardTitle>{title}</CardTitle>
      {description && <CardDescription>{description}</CardDescription>}
    </CardHeader>
  </Card>
);

type DataRow = Record<string, unknown>;

interface TablePagination {
  page: number;
  page_size: number;
  total_rows: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
}

interface WorkspaceTableProps {
  data: DataRow[];
  loading?: boolean;
  workspaceId?: string;
  nodeId?: string;
  onCast?: (column: string, targetType: string, format?: string) => Promise<void>;
  onRefreshSchema?: () => Promise<NodeSchemaResponse | null>;
  pagination?: TablePagination;
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

const schemaEntriesToColumnMap = (schema?: unknown): Record<string, string> => {
  if (!schema) {
    return {};
  }

  if (isLegacySchemaArray(schema)) {
    return Object.fromEntries(schema.map(({ name, js_type }) => [name, js_type ?? 'string']));
  }

  if (typeof schema === 'object' && schema !== null) {
    return Object.fromEntries(
      Object.entries(schema as Record<string, unknown>).map(([key, value]) => [key, String(value ?? '')])
    );
  }

  return {};
};

const WorkspaceTable: React.FC<WorkspaceTableProps> = ({
  data,
  loading = false,
  workspaceId,
  nodeId,
  onCast,
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

  useEffect(() => {
    if (!workspaceId || !nodeId || !onRefreshSchema) {
      return;
    }

    let cancelled = false;
    onRefreshSchema()
      .then((schema) => {
        if (cancelled || !schema) {
          return;
        }
        const mapping = extractColumnTypes(schema);
        if (debugEnabled) {
          console.debug('WorkspaceTable: loaded column types', mapping);
        }
        setColumnTypes(mapping);
      })
      .catch((error) => {
        console.error('WorkspaceTable: failed to refresh schema', error);
      });

    return () => {
      cancelled = true;
    };
  }, [workspaceId, nodeId, onRefreshSchema, debugEnabled]);

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
        const mapping = extractColumnTypes(schema);
        if (debugEnabled) {
          console.debug('WorkspaceTable: column types after cast', mapping);
        }
        setColumnTypes(mapping);
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
    [onCast, onRefreshSchema, debugEnabled]
  );

  const handleTypeChange = useCallback(
    (column: string, newType: string) => {
      if (!onCast) {
        return;
      }

      const currentType = normalizeTypeName(columnTypes[column] ?? 'string');
      const targetType = newType.toLowerCase();

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
      <div className="flex h-full w-full flex-col">
        <div className="flex-1 overflow-auto rounded-t-lg border border-border shadow-sm">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-muted/40">
              <TableRow>
                {columns.map((column) => {
                  const currentType = normalizeTypeName(columnTypes[column] ?? 'string');
                  const isColumnLoading = Boolean(loadingCast[column]);

                  return (
                    <TableHead
                      key={column}
                      className="whitespace-nowrap border-r border-border/70 px-4 py-3 text-left last:border-r-0"
                      style={{ minWidth: '250px' }}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-foreground">{column}</span>
                        <div className="relative flex-shrink-0">
                          <select
                            value={currentType}
                            onChange={(event) => handleTypeChange(column, event.target.value)}
                            disabled={isColumnLoading || !onCast}
                            className={cn(
                              'rounded-md border border-input bg-background px-2 py-0.5 text-xs text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                              isColumnLoading && 'cursor-not-allowed opacity-50',
                              !onCast && 'bg-muted text-muted-foreground'
                            )}
                          >
                            <option value={currentType}>{getTypeDisplayName(currentType)}</option>
                            {DATA_TYPES.filter((type) => type.value !== currentType).map((type) => (
                              <option key={type.value} value={type.value}>
                                {type.label}
                              </option>
                            ))}
                          </select>
                          {isColumnLoading && (
                            <div className="absolute -right-5 top-1/2 -translate-y-1/2">
                              <Loader2 className="h-3 w-3 animate-spin text-primary" />
                            </div>
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
        </div>
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
  const { selectedNode, selectedNodes, handlePageChange, handlePageSizeChange } = useWorkspaceSelection();
  const { joinNodes, castColumn, refreshNodeSchema, clearSelection } = useWorkspaceActions();
  const { isLoading } = useWorkspaceStatus();

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

  // Handle multi-selection: show join interface when multiple nodes are selected
  if (selectedNodes.length > 1) {
    // For now, only handle exactly 2 nodes (binary join)
    if (selectedNodes.length === 2) {
      const [leftNode, rightNode] = selectedNodes;
      
      // Create WorkspaceNode-compatible objects from React Flow nodes
      const leftSchemaMap = schemaEntriesToColumnMap(leftNode.data?.schema);
      const leftNodeForJoin = {
        node_id: leftNode.id,
        name: leftNode.data?.nodeName || leftNode.data?.label || leftNode.id,
        shape: leftNode.data?.shape || [0, 0],
        columns: leftNode.data?.columns || [],
        preview: [],
        is_text_data: leftNode.data?.isTextData || false,
        data_type: leftNode.data?.dataType || 'unknown',
        column_schema: leftSchemaMap,
        dtypes: leftSchemaMap,
        is_lazy: leftNode.data?.isLazy || false,
      };
      
      const rightSchemaMap = schemaEntriesToColumnMap(rightNode.data?.schema);
      const rightNodeForJoin = {
        node_id: rightNode.id,
        name: rightNode.data?.nodeName || rightNode.data?.label || rightNode.id,
        shape: rightNode.data?.shape || [0, 0],
        columns: rightNode.data?.columns || [],
        preview: [],
        is_text_data: rightNode.data?.isTextData || false,
        data_type: rightNode.data?.dataType || 'unknown',
        column_schema: rightSchemaMap,
        dtypes: rightSchemaMap,
        is_lazy: rightNode.data?.isLazy || false,
      };
      
      const handleJoin = async (
        leftNodeId: string,
        rightNodeId: string,
        joinColumns: { left: string; right: string },
        joinType: 'inner' | 'left' | 'right' | 'full' | 'semi' | 'anti' | 'cross',
        newNodeName: string
      ) => {
        const result = await joinNodes(
          leftNodeId,
          rightNodeId,
          joinType,
          [joinColumns.left],
          [joinColumns.right],
          newNodeName
        );
        return result;
      };

      const handleCancel = () => {
        clearSelection();
      };

      return (
        <div className="p-6">
          <JoinInterface
            leftNode={leftNodeForJoin}
            rightNode={rightNodeForJoin}
            onJoin={handleJoin}
            onCancel={handleCancel}
            loading={isLoading.operations}
          />
        </div>
      );
    } else {
      // More than 2 nodes selected - not supported yet
      return (
        <div className="p-6">
          <EmptyStateCard
            title="Multiple Nodes Selected"
            description={`${selectedNodes.length} nodes selected. Join operations currently support only 2 nodes at a time.`}
            icon={
              <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
          />
        </div>
      );
    }
  }

  if (!selectedNode) {
    return (
      <div className="p-6">
        <EmptyStateCard
          title="No Node Selected"
          description="Select a node from the graph to view its data"
          icon={
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          }
        />
      </div>
    );
  }


  // Do not short-circuit on empty data; allow table to render headers only

  return (
    <div className="flex flex-col h-full">
      {/* Consolidated header with title and metadata in one row */}
      <div className="flex-shrink-0 p-2 border-b border-border bg-muted">
        <div className="flex items-center gap-3 flex-wrap">
          <h3 className="text-sm font-medium text-gray-700">Data View</h3>
          <span className="text-gray-300">|</span>
          <span className="text-sm font-semibold text-gray-800">
            {selectedNode.data?.nodeName || selectedNode.data?.label || selectedNode.id}
          </span>
          <span className="text-xs text-gray-600">
            Shape: {(() => {
              const [rows, cols] = getDisplayShape();
              return `${rows} × ${cols}`;
            })()}
          </span>
          <span className="text-xs text-gray-600">
            {nodeData.data.length} rows loaded
          </span>
          {Array.isArray(nodeData.data) && nodeData.data.length === 0 && (
            <span className="text-xs text-gray-500 italic">
              (empty table)
            </span>
          )}
        </div>
      </div>

      {/* Data table with column type casting */}
      <div className="flex-1 overflow-auto">
        <WorkspaceTable
          data={nodeData.data}
          loading={isLoading.nodeData}
          workspaceId={currentWorkspaceId || undefined}
          nodeId={selectedNode.id}
          onCast={async (column: string, targetType: string, format?: string) => {
            await castColumn(selectedNode.id, column, targetType, format);
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
  );
});

WorkspaceDataView.displayName = 'WorkspaceDataView';
