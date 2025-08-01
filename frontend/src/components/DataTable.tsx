import React, { useState, useEffect } from 'react';
import { NodeSchemaResponse } from '../types';
import DatetimeFormatModal from './DatetimeFormatModal';

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
  { value: 'number', label: 'number', category: 'Numeric' },
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
  
  console.log('DataTable received data:', data, 'loading:', loading);

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
          
          console.log('DataTable: Loaded column types:', columnTypeMapping);
          setColumnTypes(columnTypeMapping);
        }
      });
    }
  }, [workspaceId, nodeId, onRefreshSchema]);
  
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

  if (!data || data.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        No data available
      </div>
    );
  }

  // Check if first row exists and is a valid object
  if (!data[0] || typeof data[0] !== 'object' || data[0] === null) {
    return (
      <div className="text-center py-8 text-gray-500">
        Invalid data format
      </div>
    );
  }

  const columns = Object.keys(data[0]);

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
          
          console.log('DataTable: Refreshed column types after cast:', columnTypeMapping);
          setColumnTypes(columnTypeMapping);
        }
      }
    } catch (error) {
      console.error('Cast error:', error);
      // You might want to show an error message to the user here
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
    if (lowercaseType.includes('int64') || lowercaseType === 'i64') return 'number';
    if (lowercaseType.includes('int32') || lowercaseType === 'i32') return 'number';
    if (lowercaseType.includes('float64') || lowercaseType === 'f64') return 'number';
    if (lowercaseType.includes('float32') || lowercaseType === 'f32') return 'number';
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
      <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50">
        {/* Left side: Page size selector and row info */}
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <span className="text-sm text-gray-700">Show</span>
            <select
              value={page_size}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {PAGE_SIZE_OPTIONS.map(size => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
            <span className="text-sm text-gray-700">rows</span>
          </div>
          <div className="text-sm text-gray-700">
            Showing {Math.min((page - 1) * page_size + 1, total_rows)} to {Math.min(page * page_size, total_rows)} of {total_rows} rows
          </div>
        </div>

        {/* Right side: Navigation controls */}
        <div className="flex items-center space-x-2">
          <button
            onClick={() => onPageChange(1)}
            disabled={!has_prev}
            className="px-3 py-1 text-sm border border-gray-300 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
            title="First page"
          >
            ⟨⟨
          </button>
          <button
            onClick={() => onPageChange(page - 1)}
            disabled={!has_prev}
            className="px-3 py-1 text-sm border border-gray-300 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
            title="Previous page"
          >
            ⟨
          </button>
          
          <div className="flex items-center space-x-1">
            <span className="text-sm text-gray-700">Page</span>
            <input
              type="number"
              value={page}
              onChange={(e) => {
                const newPage = Number(e.target.value);
                if (newPage >= 1 && newPage <= total_pages) {
                  onPageChange(newPage);
                }
              }}
              className="w-16 px-2 py-1 text-sm border border-gray-300 rounded text-center focus:outline-none focus:ring-1 focus:ring-blue-500"
              min={1}
              max={total_pages}
            />
            <span className="text-sm text-gray-700">of {total_pages}</span>
          </div>

          <button
            onClick={() => onPageChange(page + 1)}
            disabled={!has_next}
            className="px-3 py-1 text-sm border border-gray-300 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
            title="Next page"
          >
            ⟩
          </button>
          <button
            onClick={() => onPageChange(total_pages)}
            disabled={!has_next}
            className="px-3 py-1 text-sm border border-gray-300 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
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
        <div className="flex-1 overflow-auto border border-gray-200 rounded-t-lg shadow-sm">
          <table className="border-collapse bg-white" style={{ minWidth: '100%', width: 'max-content' }}>
            <thead className="bg-gradient-to-r from-gray-50 to-gray-100 sticky top-0 z-10">
              <tr>
                {columns.map((col) => {
                  const currentType = normalizeTypeName(columnTypes[col] || 'Unknown');
                  const isLoading = loadingCast[col];
                  
                  return (
                    <th
                      key={col}
                      className="px-4 py-3 text-left border-r border-gray-200 last:border-r-0 whitespace-nowrap"
                      style={{ minWidth: '200px' }}
                    >
                      <div className="space-y-2">
                        {/* Column name - keep original case */}
                        <div className="text-xs font-medium text-gray-900">
                          {col}
                        </div>
                        
                        {/* Data type dropdown */}
                        <div className="relative">
                          <select
                            value={currentType}
                            onChange={(e) => handleTypeChange(col, e.target.value)}
                            disabled={isLoading || !onCast}
                            className={`
                              w-full text-xs border border-gray-300 rounded px-2 py-1 
                              bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 
                              ${isLoading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                              ${!onCast ? 'bg-gray-100 cursor-not-allowed' : ''}
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
                            <div className="absolute right-6 top-1/2 transform -translate-y-1/2">
                              <svg className="animate-spin h-3 w-3 text-blue-600" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                              </svg>
                            </div>
                          )}
                        </div>
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {data.map((row, i) => (
                <tr key={i} className="hover:bg-gray-50 transition-colors duration-150">
                  {columns.map((col, j) => (
                    <td
                      key={j}
                      className="px-4 py-3 text-sm text-gray-900 border-r border-gray-100 last:border-r-0 whitespace-nowrap"
                      style={{ minWidth: '200px' }}
                    >
                      {String(row[col] || '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        
        {/* Pagination controls */}
        {renderPaginationControls()}
      </div>
      
      <DatetimeFormatModal
        isOpen={datetimeModal.isOpen}
        onClose={() => setDatetimeModal({ isOpen: false, column: '', targetType: '' })}
        onConfirm={handleDatetimeFormatConfirm}
        columnName={datetimeModal.column}
      />
    </>
  );
};

export default DataTable;
