import React, { useState, useEffect } from 'react';
import { NodeSchemaResponse } from '../../types';
import DatetimeFormatModal from '../modals/DatetimeFormatModal';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table';

interface DataTableProps {
  data: any[];
  loading?: boolean;
  workspaceId?: string;
  nodeId?: string;
  onCast?: (column: string, targetType: string, format?: string) => Promise<void>;
  onRefreshSchema?: () => Promise<NodeSchemaResponse | null>;
  // Pagination props
  pagination?: {
    page: number;
    page_size: number;
    total_rows: number;
    total_pages: number;
    has_next: boolean;
    has_prev: boolean;
  };
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
}

// TypeScript-friendly data types (should match backend js_type mapping)
const DATA_TYPES = [
  { value: 'string', label: 'string', category: 'Text' },
  { value: 'integer', label: 'integer', category: 'Numeric' },
  { value: 'float', label: 'float', category: 'Numeric' },
  { value: 'boolean', label: 'boolean', category: 'Boolean' },
  { value: 'datetime', label: 'datetime', category: 'Temporal' },
  { value: 'array', label: 'array', category: 'Array' },
];

const DataTable: React.FC<DataTableProps> = ({ 
  data, 
  loading, 
  workspaceId, 
  nodeId, 
  onCast, 
  onRefreshSchema,
  pagination,
  onPageChange,
  onPageSizeChange
}) => {
  const [columnTypes, setColumnTypes] = useState<Record<string, string>>({});
  const [loadingCast, setLoadingCast] = useState<Record<string, boolean>>({});
  const [datetimeModal, setDatetimeModal] = useState<{
    isOpen: boolean;
    column: string;
    targetType: string;
  }>({ isOpen: false, column: '', targetType: '' });
  
  if (localStorage.getItem('debugDataTable') === '1') console.log('DataTable received data:', data, 'loading:', loading);

  // Load column schema when component mounts or when nodeId changes
  useEffect(() => {
    if (workspaceId && nodeId && onRefreshSchema) {
      onRefreshSchema().then(schema => {
        if (schema) {
          // Fix: Convert schema array to column_types mapping using js_type
          let columnTypeMapping: Record<string, string> = {};
          
          if (Array.isArray(schema.schema)) {
            // Schema is an array of objects with js_type fields
            columnTypeMapping = Object.fromEntries(
              schema.schema.map((col: any) => [col.name, col.js_type || 'string'])
            );
          } else if (schema.column_types) {
            // Fallback to column_types if available
            columnTypeMapping = schema.column_types;
          } else if (schema.schema && typeof schema.schema === 'object') {
            // Fallback to schema object
            columnTypeMapping = schema.schema;
          }
          
          if (localStorage.getItem('debugDataTable') === '1') console.log('DataTable: Loaded column types:', columnTypeMapping);
          setColumnTypes(columnTypeMapping);
        }
      });
    }
  }, [workspaceId, nodeId, onRefreshSchema]);

  // Derive columns: prefer row keys when available; otherwise fall back to schema (columnTypes)
  const columns = React.useMemo(() => {
    if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object' && data[0] !== null) {
      return Object.keys(data[0]);
    }
    // Fallback to schema-derived columns when data is empty
    return Object.keys(columnTypes || {});
  }, [data, columnTypes]);
  
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex items-center space-x-3">
          <svg className="animate-spin h-6 w-6 text-blue-600" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span className="text-gray-600 font-medium">Loading data...</span>
        </div>
      </div>
    );
  }

  // Check if first row exists and is a valid object (allow empty arrays)
  if (Array.isArray(data) && data.length > 0 && (typeof data[0] !== 'object' || data[0] === null)) {
    return (
      <div className="text-center py-8 text-gray-500">
        Invalid data format
      </div>
    );
  }


  const handleTypeChange = async (column: string, newType: string) => {
    if (!onCast) return;
    
    const currentType = columnTypes[column]?.toLowerCase() || '';
    
    // If converting from string to datetime, show format modal
    if (newType.toLowerCase() === 'datetime' && 
        (currentType.includes('utf8') || currentType.includes('string') || currentType === 'string')) {
      setDatetimeModal({ isOpen: true, column, targetType: newType });
      return;
    }
    
    // For other conversions, cast directly
    await performCast(column, newType);
  };

  const performCast = async (column: string, targetType: string, format?: string) => {
    if (!onCast) return;
    
    setLoadingCast(prev => ({ ...prev, [column]: true }));
    
    try {
      await onCast(column, targetType, format);
      
      // Refresh schema after successful cast
      if (onRefreshSchema) {
        const schema = await onRefreshSchema();
        if (schema) {
          // Fix: Convert schema array to column_types mapping using js_type
          let columnTypeMapping: Record<string, string> = {};
          
          if (Array.isArray(schema.schema)) {
            // Schema is an array of objects with js_type fields
            columnTypeMapping = Object.fromEntries(
              schema.schema.map((col: any) => [col.name, col.js_type || 'string'])
            );
          } else if (schema.column_types) {
            // Fallback to column_types if available
            columnTypeMapping = schema.column_types;
          } else if (schema.schema && typeof schema.schema === 'object') {
            // Fallback to schema object
            columnTypeMapping = schema.schema;
          }
          
          if (localStorage.getItem('debugDataTable') === '1') console.log('DataTable: Refreshed column types after cast:', columnTypeMapping);
          setColumnTypes(columnTypeMapping);
        }
      }
    } catch (error) {
      console.error('Cast error:', error);
      // Surface an immediate user-facing alert for failed casts (request from UX)
      let message = 'Unknown error';
      if (error instanceof Error) {
        message = error.message;
      } else if (typeof (error as any)?.toString === 'function') {
        message = (error as any).toString();
      }
      // Basic alert for now (consistent with existing pattern in other tabs)
      // Example: Failed to convert column "col" to datetime: <message>
      try {
        alert(`Failed to convert column "${column}" to ${targetType}: ${message}`);
      } catch (_) {
        // ignore if alert is blocked
      }
    } finally {
      setLoadingCast(prev => ({ ...prev, [column]: false }));
    }
  };

  const handleDatetimeFormatConfirm = (format?: string) => {
    const { column, targetType } = datetimeModal;
    setDatetimeModal({ isOpen: false, column: '', targetType: '' });
    performCast(column, targetType, format);
  };

  const getTypeDisplayName = (type: string): string => {
    const dataType = DATA_TYPES.find(dt => dt.value === type);
    return dataType ? dataType.label : type;
  };

  const normalizeTypeName = (type: string): string => {
    // Normalize various type representations to js_type compatible names
    const lowercaseType = type.toLowerCase();
    if (lowercaseType.includes('utf8') || lowercaseType.includes('string')) return 'string';
    if (lowercaseType.includes('int64') || lowercaseType === 'i64' || lowercaseType.includes('int32') || lowercaseType === 'i32' || lowercaseType.includes('int')) return 'integer';
    if (lowercaseType.includes('float64') || lowercaseType === 'f64' || lowercaseType.includes('float32') || lowercaseType === 'f32' || lowercaseType.includes('float')) return 'float';
    if (lowercaseType.includes('bool')) return 'boolean';
    if (lowercaseType.includes('datetime')) return 'datetime';
    if (lowercaseType.includes('date')) return 'datetime';
    return type;
  };

  const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

  const renderPaginationControls = () => {
    if (!pagination || !onPageChange || !onPageSizeChange) {
      return null;
    }

    const { page, page_size, total_rows, total_pages, has_next, has_prev } = pagination;

    return (
  <div className="flex items-center justify-between border-t border-border bg-muted/40 px-4 py-3">
        {/* Left side: Page size selector and row info */}
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <span className="text-sm text-muted-foreground">Show</span>
            <select
              value={page_size}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {PAGE_SIZE_OPTIONS.map(size => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
            <span className="text-sm text-muted-foreground">rows</span>
          </div>
          <div className="text-sm text-muted-foreground">
            Showing {Math.min((page - 1) * page_size + 1, total_rows)} to {Math.min(page * page_size, total_rows)} of {total_rows} rows
          </div>
        </div>

        {/* Right side: Navigation controls */}
        <div className="flex items-center space-x-2">
          <button
            onClick={() => onPageChange(1)}
            disabled={!has_prev}
            className="rounded-md border border-input px-3 py-1 text-sm text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            title="First page"
          >
            ⟨⟨
          </button>
          <button
            onClick={() => onPageChange(page - 1)}
            disabled={!has_prev}
            className="rounded-md border border-input px-3 py-1 text-sm text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            title="Previous page"
          >
            ⟨
          </button>
          
          <div className="flex items-center space-x-1">
            <span className="text-sm text-muted-foreground">Page</span>
            <input
              type="number"
              value={page}
              onChange={(e) => {
                const newPage = Number(e.target.value);
                if (newPage >= 1 && newPage <= total_pages) {
                  onPageChange(newPage);
                }
              }}
              className="w-16 rounded-md border border-input px-2 py-1 text-center text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              min={1}
              max={total_pages}
            />
            <span className="text-sm text-muted-foreground">of {total_pages}</span>
          </div>

          <button
            onClick={() => onPageChange(page + 1)}
            disabled={!has_next}
            className="rounded-md border border-input px-3 py-1 text-sm text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            title="Next page"
          >
            ⟩
          </button>
          <button
            onClick={() => onPageChange(total_pages)}
            disabled={!has_next}
            className="rounded-md border border-input px-3 py-1 text-sm text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            title="Last page"
          >
            ⟩⟩
          </button>
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="h-full w-full flex flex-col">
        <div className="flex-1 overflow-auto rounded-t-lg border border-border shadow-sm">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-muted/40">
              <TableRow>
                {columns.map((col) => {
                  const currentType = normalizeTypeName(columnTypes[col] || 'Unknown');
                  const isLoading = loadingCast[col];
                  
                  return (
                    <TableHead
                      key={col}
                      className="whitespace-nowrap border-r border-border/70 px-4 py-3 text-left last:border-r-0"
                      style={{ minWidth: '250px' }}
                    >
                      <div className="flex items-center gap-2">
                        {/* Column name - keep original case */}
                        <span className="text-xs font-medium text-foreground">
                          {col}
                        </span>
                        
                        {/* Data type dropdown inline */}
                        <div className="relative flex-shrink-0">
                          <select
                            value={currentType}
                            onChange={(e) => handleTypeChange(col, e.target.value)}
                            disabled={isLoading || !onCast}
                            className={`
                              rounded-md border border-input bg-background px-2 py-0.5 text-xs text-foreground shadow-sm 
                              focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring
                              ${isLoading ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}
                              ${!onCast ? 'bg-muted text-muted-foreground' : ''}
                            `}
                          >
                            <option value={currentType}>
                              {getTypeDisplayName(currentType)}
                            </option>
                            {DATA_TYPES
                              .filter(dt => dt.value !== currentType)
                              .map(dt => (
                                <option key={dt.value} value={dt.value}>
                                  {dt.label}
                                </option>
                              ))
                            }
                          </select>
                          
                          {/* Loading indicator */}
                          {isLoading && (
                            <div className="absolute -right-5 top-1/2 -translate-y-1/2 transform">
                              <svg className="h-3 w-3 animate-spin text-primary" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                              </svg>
                            </div>
                          )}
                        </div>
                      </div>
                    </TableHead>
                  );
                })}
              </TableRow>
            </TableHeader>
            <TableBody className="bg-white divide-y divide-gray-200">
              {data.map((row, i) => (
                <TableRow key={i} className="hover:bg-gray-50 transition-colors duration-150">
                  {columns.map((col, j) => (
                    <TableCell
                      key={j}
                      className="whitespace-nowrap border-r border-border/60 px-4 py-3 text-sm text-foreground last:border-r-0"
                      style={{ minWidth: '200px' }}
                    >
                      {String(row[col] || '')}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        
        {/* Pagination controls */}
        {renderPaginationControls()}
      </div>
      
      <DatetimeFormatModal
        isOpen={datetimeModal.isOpen}
        onClose={() => setDatetimeModal({ isOpen: false, column: '', targetType: '' })}
        onConfirm={handleDatetimeFormatConfirm}
        columnName={datetimeModal.column}
        sampleValues={(data || []).slice(0, 25).map((row: any) => String(row[datetimeModal.column] ?? '')).filter(v => v)}
      />
    </>
  );
};

export default DataTable;
