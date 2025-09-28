import React, { useState, useEffect, useMemo } from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { useWorkspaceSelection } from '../../hooks/useWorkspaceSelection';
import { useWorkspaceData } from '../../hooks/useWorkspaceData';
import { useWorkspaceActions } from '../../hooks/useWorkspaceActions';
import { useWorkspaceStatus } from '../../hooks/useWorkspaceStatus';
// Import nodesApi for filter operation (types redefined locally for UI)
import { nodesApi } from '../../api/nodes';
// Define minimal request types (backend expects these shapes)
interface FilterCondition { column: string; operator: 'eq' | 'gte' | 'lte' | 'contains' | 'startswith' | 'endswith' | 'is_null' | 'between'; value: any; negate?: boolean; regex?: boolean; }
interface FilterRequest { conditions: FilterCondition[]; logic?: string; new_node_name?: string; }

// (Removed unused DATA_TYPES constant to satisfy lint)

// Utility function to normalize type names
const normalizeTypeName = (type: string): string => {
  const lowercaseType = type.toLowerCase();
  if (lowercaseType.includes('utf8') || lowercaseType.includes('string')) return 'string';
  if (lowercaseType.includes('int') && !lowercaseType.includes('interval')) return 'integer';
  if (lowercaseType.includes('float') || lowercaseType.includes('double')) return 'float';
  if (lowercaseType.includes('bool')) return 'boolean';
  if (lowercaseType.includes('datetime') || lowercaseType.includes('timestamp')) return 'datetime';
  if (lowercaseType.includes('list') || lowercaseType.includes('array')) return 'array';
  return 'string'; // Default fallback
};

// Get operators for each data type (simplified, lowercase labels)
// Removed: not equal, is not null, greater than, less than
// Kept: equals, contains/startswith/endswith (strings), is null, gte, lte, between
const getOperatorsForType = (dataType: string) => {
  switch (dataType) {
    case 'string':
      return [
  { value: 'eq', label: 'equals' },
  { value: 'contains', label: 'contains' },
  { value: 'startswith', label: 'starts with' },
  { value: 'endswith', label: 'ends with' },
  { value: 'is_null', label: 'is null' },
      ];
    case 'integer':
    case 'float':
      return [
  { value: 'eq', label: 'equals' },
  { value: 'gte', label: 'greater than or equal' },
  { value: 'lte', label: 'less than or equal' },
  { value: 'is_null', label: 'is null' },
      ];
    case 'boolean':
      return [
  { value: 'eq', label: 'equals' },
  { value: 'is_null', label: 'is null' },
      ];
    case 'datetime':
      return [
  { value: 'eq', label: 'equals' },
  { value: 'gte', label: 'after or equal' },
  { value: 'lte', label: 'before or equal' },
  { value: 'between', label: 'between' },
  { value: 'is_null', label: 'is null' },
      ];
    default:
      return [
  { value: 'eq', label: 'equals' },
  { value: 'is_null', label: 'is null' },
      ];
  }
};

const ISO_PLACEHOLDER = 'YYYY-MM-DDTHH:MM:SS+00:00';

const normalizeIsoDraft = (txt: string): string => {
  let s = txt.trim();
  if (!s) return s;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += 'T00:00:00+00:00';
  if (/T\d{2}:\d{2}(\+00:00)?$/.test(s)) s = s.replace(/T(\d{2}:\d{2})(\+00:00)?$/, (m, hm, tz) => `T${hm}:00${tz || '+00:00'}`);
  if (/T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(s)) s += '+00:00';
  s = s.replace(/Z$/, '+00:00');
  return s;
};

const parseIsoToLocalDate = (input: string): Date | null => {
  if (!input) return null;
  let candidate = input.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
    candidate += 'T00:00:00+00:00';
  }
  if (/T\d{2}:\d{2}(Z|[+-]\d{2}:?\d{2})?$/.test(candidate)) {
    candidate = candidate.replace(/T(\d{2}:\d{2})(Z|[+-]\d{2}:?\d{2})?$/, (m, hm, tz) => `T${hm}:00${tz || '+00:00'}`);
  }
  if (/T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(candidate)) {
    candidate += '+00:00';
  }
  candidate = candidate.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  const d = new Date(candidate);
  if (isNaN(d.getTime())) return null;
  try {
    const m = candidate.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
    if (m) {
      const [, Y, M, D, H, Min, S] = m;
      return new Date(Number(Y), Number(M) - 1, Number(D), Number(H), Number(Min), Number(S));
    }
  } catch { /* ignore */ }
  return d;
};

interface IsoDateInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  committedValue: string;
  onCommit: (value: string) => void;
}

const IsoDateInput = React.forwardRef<HTMLInputElement, IsoDateInputProps>((props, externalRef) => {
  const {
    committedValue,
    onCommit,
    onBlur: parentOnBlur,
    onFocus: parentOnFocus,
    onClick: parentOnClick,
    onChange: parentOnChange,
    onKeyDown: parentOnKeyDown,
    onPaste: parentOnPaste,
    readOnly: parentReadOnly,
    className: parentClassName,
    placeholder = ISO_PLACEHOLDER,
    ...restProps
  } = props;

  const [draft, setDraft] = React.useState(committedValue);
  const [focused, setFocused] = React.useState(false);

  React.useEffect(() => {
    if (!focused) {
      setDraft(committedValue);
    }
  }, [committedValue, focused]);

  const innerRef = React.useRef<HTMLInputElement | null>(null);
  const setRefs = React.useCallback((el: HTMLInputElement | null) => {
    innerRef.current = el;
    if (typeof externalRef === 'function') {
      externalRef(el);
    } else if (externalRef) {
      (externalRef as React.MutableRefObject<HTMLInputElement | null>).current = el;
    }
  }, [externalRef]);

  const commitNormalized = (text: string, { syncDraft = false }: { syncDraft?: boolean } = {}) => {
    const trimmed = text.trim();
    if (!trimmed) {
      onCommit('');
      if (syncDraft) setDraft('');
      return;
    }
    const normalized = normalizeIsoDraft(trimmed);
    if (!normalized) return;
    if (!parseIsoToLocalDate(normalized)) return;
    onCommit(normalized);
    if (syncDraft) setDraft(normalized);
  };

  return (
    <input
      {...restProps}
      ref={setRefs}
      type="text"
      readOnly={parentReadOnly ?? false}
      value={draft}
      onClick={(e) => {
        parentOnClick?.(e);
      }}
      onFocus={(e) => {
        setFocused(true);
        parentOnFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        commitNormalized(draft, { syncDraft: true });
        parentOnBlur?.(e);
      }}
      onChange={(e) => {
        parentOnChange?.(e);
        const next = e.target.value;
        setDraft(next);
        commitNormalized(next);
      }}
      onPaste={(e) => {
        parentOnPaste?.(e);
        if (typeof window === 'undefined') return;
        requestAnimationFrame(() => {
          const input = e.target as HTMLInputElement;
          setDraft(input.value);
          commitNormalized(input.value);
        });
      }}
      onKeyDown={(e) => {
        parentOnKeyDown?.(e);
        if (e.key === 'Enter') {
          commitNormalized(draft, { syncDraft: true });
          (e.target as HTMLInputElement).blur();
        }
      }}
      placeholder={placeholder}
      className={`${parentClassName ? `${parentClassName} ` : ''}px-2 py-1 border border-gray-300 rounded text-sm font-mono`}
      size={28}
      style={{ width: '28ch', minWidth: '28ch', maxWidth: '28ch', flex: 'none' }}
    />
  );
});

// Extended interface for UI with tracking ID
interface FilterConditionWithId extends Omit<FilterCondition, 'value'> {
  id: string;
  dataType?: string;
  value: string | number | boolean | Date | { start: string | Date | null; end: string | Date | null } | null;
  negate?: boolean;
  regex?: boolean;
}

type PreviewPagination = {
  page: number;
  page_size: number;
  total_rows: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
};

const PREVIEW_PAGE_SIZE_OPTIONS = [10, 20, 50];

const hasNonEmptyValue = (value: any): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return true;
  if (typeof value === 'boolean') return true;
  if (value instanceof Date) return true;
  if (typeof value === 'object') {
    if ('start' in value || 'end' in value) {
      return hasNonEmptyValue((value as any).start) || hasNonEmptyValue((value as any).end);
    }
    return Object.values(value).some((entry) => hasNonEmptyValue(entry));
  }
  return true;
};

const serializeConditionsForRequest = (conditions: FilterConditionWithId[]) => {
  return conditions.map((c) => {
    let value: any;
    if (c.operator === 'is_null') {
      value = null;
    } else if (c.value instanceof Date) {
      value = c.value.toISOString();
    } else if (c.value && typeof c.value === 'object' && 'start' in c.value) {
      const range: any = c.value;
      const normalizeEdge = (edge: any) => {
        if (edge instanceof Date) return edge.toISOString();
        if (typeof edge === 'string') {
          const trimmed = edge.trim();
          return trimmed.length ? trimmed : null;
        }
        return edge ?? null;
      };
      value = {
        start: normalizeEdge(range.start),
        end: normalizeEdge(range.end),
      };
    } else {
      value = c.value;
    }

    const payload: any = { column: c.column, operator: c.operator, value };
    if (c.negate !== undefined) payload.negate = Boolean(c.negate);
    if (c.regex !== undefined) payload.regex = Boolean(c.regex);
    return payload;
  });
};

const buildFilterRequestPayload = (
  conditions: FilterConditionWithId[],
  logic: string,
  newNodeName?: string
): FilterRequest => ({
  conditions: serializeConditionsForRequest(conditions),
  logic,
  new_node_name: newNodeName && newNodeName.trim() ? newNodeName : undefined,
});

const isConditionComplete = (condition: FilterConditionWithId): boolean => {
  if (!condition.column) return false;
  if (condition.operator === 'is_null') return true;
  if (condition.operator === 'between') {
    const range = condition.value && typeof condition.value === 'object' ? condition.value : {};
    return hasNonEmptyValue(range);
  }
  return hasNonEmptyValue(condition.value);
};

const formatPreviewValue = (value: any): string => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
};

// Removed DatePicker & custom time input: now using direct ISO8601 text input for timezone-aware datetime entry.

const FilterTab: React.FC = () => {
  const { selectedNodeId, selectedNode } = useWorkspaceSelection();
  const { nodeData } = useWorkspaceData();
  const { filterNode, filterPreview } = useWorkspaceActions();
  const { isLoading } = useWorkspaceStatus();

  const [conditions, setConditions] = useState<FilterConditionWithId[]>([{
    id: '1',
    column: '',
    operator: 'eq',
    value: '',
    negate: false,
    regex: true,
  }]);
  const [logic, setLogic] = useState<'and' | 'or'>('and');
  const [newNodeName, setNewNodeName] = useState('');
  const [isFiltering, setIsFiltering] = useState(false);
  const [previewPage, setPreviewPage] = useState(1);
  const [previewPageSize, setPreviewPageSize] = useState(10);
  const [previewData, setPreviewData] = useState<any[]>([]);
  const [previewColumns, setPreviewColumns] = useState<string[]>([]);
  const [previewPagination, setPreviewPagination] = useState<PreviewPagination | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [debouncedRequest, setDebouncedRequest] = useState<{ request: FilterRequest; signature: string } | null>(null);

  // Get available columns with their datatypes from node data
  const availableColumns = useMemo(() => {
    const columns: Array<{name: string, dataType: string}> = [];
    
    // First try to get columns from nodeData (which includes actual column names)
    if (nodeData?.columns && Array.isArray(nodeData.columns) && nodeData?.dtypes) {
      nodeData.columns.forEach((colName: string) => {
        const rawDataType = nodeData.dtypes[colName] || 'unknown';
        const normalizedDataType = normalizeTypeName(rawDataType);
        columns.push({ name: colName, dataType: normalizedDataType });
      });
    }
    // Fallback to dtypes keys if available
    else if (nodeData?.dtypes && typeof nodeData.dtypes === 'object') {
      Object.keys(nodeData.dtypes).forEach(colName => {
        const rawDataType = nodeData.dtypes[colName] || 'unknown';
        const normalizedDataType = normalizeTypeName(rawDataType);
        columns.push({ name: colName, dataType: normalizedDataType });
      });
    }
    // Last fallback to schema if available
    else if (selectedNode?.data?.schema) {
      Object.keys(selectedNode.data.schema).forEach(colName => {
        // Schema doesn't have types, so default to string
        columns.push({ name: colName, dataType: 'string' });
      });
    }
    
    return columns;
  }, [nodeData?.columns, nodeData?.dtypes, selectedNode?.data?.schema]);

  const hasSelection = Boolean(selectedNodeId);
  const hasSchema = availableColumns.length > 0;
  const isSchemaLoading = hasSelection && !hasSchema && (isLoading.nodeData || isLoading.graph);
  const isConfigDisabled = !hasSelection || !hasSchema;

  // Auto-generate node name based on selected node
  useEffect(() => {
    if (selectedNode?.data?.name) {
      setNewNodeName(`${selectedNode.data.name}_filtered`);
    } else if (!selectedNodeId) {
      setNewNodeName('');
    }
  }, [selectedNode, selectedNodeId]);

  const previewRequest = useMemo(() => {
    if (!conditions.length) return null;
    return buildFilterRequestPayload(conditions, logic);
  }, [conditions, logic]);

  const previewRequestSignature = useMemo(() => {
    if (!previewRequest) return '';
    const baseSignature = JSON.stringify(previewRequest);
    return selectedNodeId ? `${selectedNodeId}::${baseSignature}` : baseSignature;
  }, [previewRequest, selectedNodeId]);

  const previewReady = hasSelection && conditions.length > 0 && conditions.every(isConditionComplete);

  const previewColumnsToRender = useMemo(() => {
    if (previewColumns.length > 0) return previewColumns;
    if (previewData.length > 0 && typeof previewData[0] === 'object' && previewData[0] !== null) {
      return Object.keys(previewData[0]);
    }
    return [];
  }, [previewColumns, previewData]);

  const handlePreviewPrev = () => {
    if (previewPagination?.has_prev && !previewLoading) {
      setPreviewPage((prev) => Math.max(1, prev - 1));
    }
  };

  const handlePreviewNext = () => {
    if (previewPagination?.has_next && !previewLoading) {
      setPreviewPage((prev) => prev + 1);
    }
  };

  const handlePreviewPageSizeChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const nextSize = Number(event.target.value);
    if (!Number.isNaN(nextSize)) {
      setPreviewPageSize(nextSize);
      setPreviewPage(1);
    }
  };

  const resolvedTotalPages = useMemo(() => {
    if (!previewPagination) return 0;
    if (previewPagination.total_pages) return previewPagination.total_pages;
    if (!previewPagination.total_rows) return 0;
    return Math.ceil(previewPagination.total_rows / previewPagination.page_size);
  }, [previewPagination]);

  const currentPreviewPage = previewPagination?.page ?? previewPage;
  const previewTableColSpan = Math.max(previewColumnsToRender.length, 1);
  const displayTotalPages = resolvedTotalPages > 0 ? resolvedTotalPages : 1;

  useEffect(() => {
    setPreviewPage(1);
  }, [previewRequestSignature]);

  useEffect(() => {
    if (!previewReady || !previewRequest || !previewRequestSignature) {
      if (!previewReady) {
        setPreviewData([]);
        setPreviewColumns([]);
        setPreviewPagination(null);
      }
      setPreviewError(null);
      setDebouncedRequest(null);
      if (!previewReady) {
        setPreviewLoading(false);
      }
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setDebouncedRequest({ request: previewRequest, signature: previewRequestSignature });
    }, 600);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [previewReady, previewRequest, previewRequestSignature]);

  useEffect(() => {
    if (!debouncedRequest || !selectedNodeId || !previewReady) return;

    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError(null);

    filterPreview(selectedNodeId, debouncedRequest.request, previewPage, previewPageSize)
      .then((resp) => {
        if (cancelled) return;
        const rows = Array.isArray(resp?.data) ? resp.data : [];
        const cols = Array.isArray(resp?.columns) ? resp.columns : [];
        setPreviewData(rows);
        setPreviewColumns(cols);
        if (resp?.pagination) {
          setPreviewPagination(resp.pagination);
          if (resp.pagination.page && resp.pagination.page !== previewPage) {
            setPreviewPage(resp.pagination.page);
          }
        } else {
          setPreviewPagination(null);
        }
      })
      .catch((error: any) => {
        if (cancelled) return;
        const message = error?.message || 'Failed to load preview data';
        setPreviewError(message);
        setPreviewData([]);
        setPreviewColumns([]);
        setPreviewPagination(null);
      })
      .finally(() => {
        if (!cancelled) {
          setPreviewLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [debouncedRequest, selectedNodeId, previewReady, previewPage, previewPageSize, filterPreview]);

  const handleAddCondition = () => {
    const firstColumn = availableColumns[0];
    const newCondition: FilterConditionWithId = {
      id: Date.now().toString(),
      column: firstColumn ? firstColumn.name : '',
      operator: 'eq',
      value: '',
      dataType: firstColumn ? firstColumn.dataType : 'string',
      negate: false,
      regex: true,
    };
    setConditions([...conditions, newCondition]);
  };

  const handleRemoveCondition = (id: string) => {
    if (conditions.length > 1) {
      setConditions(conditions.filter(c => c.id !== id));
    }
  };

  const handleConditionChange = (id: string, field: keyof FilterConditionWithId, value: any) => {
    setConditions(conditions.map(c => {
      if (c.id === id) {
        const updated = { ...c, [field]: value };
        
        // If column changed, update dataType and reset operator
        if (field === 'column') {
          const columnInfo = availableColumns.find(col => col.name === value);
          if (columnInfo) {
            updated.dataType = columnInfo.dataType;
            updated.operator = 'eq'; // Reset to default operator
            updated.value = ''; // Reset value
          }
        }
        
        return updated;
      }
      return c;
    }));
  };

  // Render appropriate input based on data type and operator
  const renderValueInput = (condition: FilterConditionWithId, disabled: boolean) => {
    if (disabled) {
      return (
        <input
          type="text"
          value={condition.operator === 'between' ? '' : String(condition.value ?? '')}
          disabled
          placeholder={hasSelection ? 'Select a column' : 'Select a node to configure filters'}
          className="px-2 py-1 border border-gray-200 rounded text-sm flex-1 bg-gray-100 text-gray-500"
        />
      );
    }

    const dataType = condition.dataType || 'string';

    if (dataType === 'boolean') {
      return (
        <select
          value={String(condition.value)}
          onChange={(e) => handleConditionChange(condition.id, 'value', e.target.value === 'true')}
          className="px-2 py-1 border border-gray-300 rounded text-sm flex-1"
          disabled={disabled}
        >
          <option value="">Select value</option>
          <option value="true">True</option>
          <option value="false">False</option>
        </select>
      );
    }

    if (dataType === 'datetime') {
      const buildPicker = (committedValue: string, commitValue: (v: string)=>void) => {
        const committedDate = parseIsoToLocalDate(committedValue);

        return disabled ? (
          <input
            type="text"
            value={committedValue}
            disabled
            placeholder={ISO_PLACEHOLDER}
            className="px-2 py-1 border border-gray-200 rounded text-sm font-mono bg-gray-100 text-gray-500"
          />
        ) : (
          <DatePicker
            selected={committedDate || undefined}
            onChange={(d) => {
              if (d) {
                const pad = (n:number) => String(n).padStart(2,'0');
                const iso = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}+00:00`;
                commitValue(iso);
              } else {
                commitValue('');
              }
            }}
            showTimeSelect
            timeIntervals={15}
            dateFormat="yyyy-MM-dd'T'HH:mm:ssXXX"
            customInput={(
              <IsoDateInput
                committedValue={committedValue}
                onCommit={(value) => commitValue(value)}
              />
            )}
            popperClassName="z-50"
          />
        );
      };
      if (condition.operator === 'between') {
        const rangeValue = (condition.value as { start?: string | Date | null; end?: string | Date | null }) || {};
        const startStr =
          typeof rangeValue.start === 'string'
            ? rangeValue.start
            : rangeValue.start instanceof Date
              ? rangeValue.start.toISOString()
              : '';
        const endStr =
          typeof rangeValue.end === 'string'
            ? rangeValue.end
            : rangeValue.end instanceof Date
              ? rangeValue.end.toISOString()
              : '';
        return (
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex-none">{buildPicker(startStr, (v) => handleConditionChange(condition.id, 'value', { ...rangeValue, start: v }))}</div>
            <div className="flex-none">{buildPicker(endStr, (v) => handleConditionChange(condition.id, 'value', { ...rangeValue, end: v }))}</div>
          </div>
        );
      }
      const singleVal =
        typeof condition.value === 'string'
          ? condition.value
          : condition.value instanceof Date
            ? condition.value.toISOString()
            : '';
      return buildPicker(singleVal, (v) => handleConditionChange(condition.id, 'value', v));
    }

    if (dataType === 'integer' || dataType === 'float') {
      return (
        <input
          type="number"
          step={dataType === 'float' ? 'any' : '1'}
          value={condition.value === null ? '' : String(condition.value ?? '')}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === '') {
              handleConditionChange(condition.id, 'value', '');
              return;
            }
            const parsed = dataType === 'integer' ? parseInt(raw, 10) : parseFloat(raw);
            handleConditionChange(condition.id, 'value', Number.isNaN(parsed) ? '' : parsed);
          }}
          placeholder="Enter number"
          className="px-2 py-1 border border-gray-300 rounded text-sm flex-1"
          disabled={disabled}
        />
      );
    }

    // Default: string input
    return (
      <input
        type="text"
        value={String(condition.value)}
        onChange={(e) => handleConditionChange(condition.id, 'value', e.target.value)}
        placeholder="Enter value"
        className="px-2 py-1 border border-gray-300 rounded text-sm flex-1"
        disabled={disabled}
      />
    );
  };

  const handleApplyFilter = async () => {
    if (!selectedNodeId) {
      alert('Please select a node first');
      return;
    }

  if (conditions.length === 0 || conditions.some((condition) => !isConditionComplete(condition))) {
      alert('Please fill in all filter conditions');
      return;
    }

    const request: FilterRequest = buildFilterRequestPayload(conditions, logic, newNodeName);

    try {
      setIsFiltering(true);
      await filterNode(selectedNodeId, request);
      // Success - the graph should automatically refresh due to query invalidation
    } catch (error) {
      console.error('Filter error:', error);
      alert(`Error applying filter: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsFiltering(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-800">Filter &amp; Slice Data</h2>
            <p className="text-sm text-gray-600 max-w-2xl">
              Create a new node by applying column-based filters to the selected dataset. Define one or more conditions and choose how they combine.
            </p>
          </div>
          {isFiltering && (
            <span className="px-3 py-1 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-md">
              Running…
            </span>
          )}
        </div>

        <section className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-700">
                Selected Node ({hasSelection ? 1 : 0}/1)
              </label>
            </div>
            {!hasSelection ? (
              <div className="text-sm text-gray-500 italic bg-gray-50 border border-gray-200 p-3 rounded-md">
                No nodes selected. Single click on a node in the workspace view to select it (max 1 for this operation).
              </div>
            ) : (
              <div className="space-y-4">
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                  <div className="text-sm font-medium text-slate-800 break-words">
                    {selectedNode?.data?.nodeName || selectedNode?.data?.label || selectedNode?.data?.name || selectedNode?.label || selectedNode?.id || selectedNodeId}
                  </div>
                  <div className="text-xs text-slate-500 break-all">{selectedNodeId}</div>
                </div>

                {isSchemaLoading ? (
                  <div className="rounded-md border border-dashed border-amber-300 bg-amber-50/80 p-4 text-sm text-amber-700">
                    Loading column metadata…
                  </div>
                ) : hasSchema ? (
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-slate-600 tracking-wide">SCHEMA</div>
                    <div className="overflow-x-auto border border-slate-200 rounded-md bg-white">
                      <table className="text-[11px] font-mono border-collapse">
                        <tbody>
                          <tr className="align-top">
                            {availableColumns.map((col) => (
                              <td key={`${col.name}-name`} className="px-2 py-1 font-semibold text-slate-700 whitespace-nowrap border-b border-slate-100 min-w-[6rem]">
                                {col.name}
                              </td>
                            ))}
                          </tr>
                          <tr className="align-top">
                            {availableColumns.map((col) => (
                              <td key={`${col.name}-type`} className="px-2 py-1 text-slate-500 whitespace-nowrap min-w-[6rem]">
                                {col.dataType}
                              </td>
                            ))}
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <div className="text-[10px] text-slate-400">Scroll horizontally to view all {availableColumns.length} column(s).</div>
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed border-amber-300 bg-amber-50/80 p-4 text-sm text-amber-700">
                    No schema information is available for this node yet.
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <h3 className="text-lg font-semibold text-gray-800">Filter conditions</h3>
              <button
                onClick={handleAddCondition}
                disabled={isConfigDisabled}
                className="px-3 py-1.5 rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:text-gray-500"
              >
                Add condition
              </button>
            </div>

            {hasSelection && isSchemaLoading && (
              <div className="rounded-md border border-dashed border-amber-300 bg-amber-50/80 p-4 text-sm text-amber-700">
                Retrieving column information…
              </div>
            )}

            {!hasSelection && (
              <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
                Configure conditions once a node is selected.
              </div>
            )}

            <div className="space-y-3">
              {conditions.map((condition, index) => {
                const rowDisabled = isConfigDisabled || !condition.column;
                return (
                  <div key={condition.id} className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 md:flex-row md:items-center md:gap-3">
                    <div className="flex items-center gap-2 md:w-auto">
                      {index > 0 && (
                        <select
                          value={logic}
                          onChange={(e) => setLogic(e.target.value as 'and' | 'or')}
                          disabled={isConfigDisabled}
                          className="px-2 py-1 border border-slate-300 rounded text-sm bg-white disabled:bg-slate-100 disabled:text-slate-400"
                        >
                          <option value="and">AND</option>
                          <option value="or">OR</option>
                        </select>
                      )}

                      <label className="flex items-center gap-1 text-xs text-slate-700">
                        <input
                          aria-label="negate condition"
                          type="checkbox"
                          checked={Boolean(condition.negate)}
                          onChange={(e) => handleConditionChange(condition.id, 'negate' as any, e.target.checked)}
                          disabled={isConfigDisabled}
                        />
                        negate
                      </label>

                      {condition.dataType === 'string' && condition.operator === 'contains' && (
                        <label className="flex items-center gap-1 text-xs text-slate-700">
                          <input
                            aria-label="use regex"
                            type="checkbox"
                            checked={Boolean(condition.regex ?? true)}
                            onChange={(e) => handleConditionChange(condition.id, 'regex' as any, e.target.checked)}
                            disabled={isConfigDisabled}
                          />
                          regex
                        </label>
                      )}
                    </div>

                    <div className="flex flex-1 flex-col gap-2 md:flex-row md:flex-wrap md:items-center md:gap-x-3 md:gap-y-2">
                      <select
                        value={condition.column}
                        onChange={(e) => handleConditionChange(condition.id, 'column', e.target.value)}
                        disabled={isConfigDisabled}
                        className="px-2 py-1 border border-slate-300 rounded text-sm flex-grow min-w-[10rem] bg-white disabled:bg-slate-100 disabled:text-slate-400"
                      >
                        <option value="">Select column</option>
                        {availableColumns.map((col) => (
                          <option key={col.name} value={col.name}>
                            {col.name} ({col.dataType})
                          </option>
                        ))}
                      </select>

                      <select
                        value={condition.operator}
                        onChange={(e) => handleConditionChange(condition.id, 'operator', e.target.value)}
                        disabled={rowDisabled}
                        className="px-2 py-1 border border-slate-300 rounded text-sm flex-none w-36 bg-white disabled:bg-slate-100 disabled:text-slate-400"
                      >
                        {!condition.column ? (
                          <option value="">Select a column first</option>
                        ) : (
                          getOperatorsForType(condition.dataType || 'string').map((op) => (
                            <option key={op.value} value={op.value}>
                              {op.label}
                            </option>
                          ))
                        )}
                      </select>

                      {condition.operator !== 'is_null' && (
                        <div className="flex-1 md:flex-auto md:min-w-[28ch] md:max-w-full">
                          {renderValueInput(condition, rowDisabled)}
                        </div>
                      )}
                    </div>

                    {conditions.length > 1 && (
                      <button
                        onClick={() => handleRemoveCondition(condition.id)}
                        className="px-2 py-1 text-sm rounded-md bg-red-500 text-white hover:bg-red-600"
                        type="button"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700" htmlFor="filter-new-node-name">
              New node name
            </label>
            <input
              id="filter-new-node-name"
              type="text"
              value={newNodeName}
              onChange={(e) => setNewNodeName(e.target.value)}
              placeholder="Enter name for filtered data"
              disabled={!hasSelection}
              className="w-full px-3 py-2 border border-slate-300 rounded-md bg-white disabled:bg-slate-100 disabled:text-slate-400"
            />
          </div>

          <button
            onClick={handleApplyFilter}
            disabled={isConfigDisabled || isFiltering || isLoading.operations}
            className="w-full px-4 py-2 rounded-md text-white font-medium bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:text-gray-500"
          >
            {isFiltering ? 'Adding to workspace…' : 'Add to Workspace'}
          </button>
        </section>
      </div>
      <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-gray-800">Preview filtered rows</h3>
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <label htmlFor="filter-preview-page-size" className="text-sm text-slate-600">Rows per page</label>
            <select
              id="filter-preview-page-size"
              value={previewPageSize}
              onChange={handlePreviewPageSizeChange}
              disabled={!previewReady || previewLoading}
              className="px-2 py-1 border border-slate-300 rounded text-sm bg-white disabled:bg-slate-100 disabled:text-slate-400"
            >
              {PREVIEW_PAGE_SIZE_OPTIONS.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>
        </div>

        {!hasSelection ? (
          <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
            Select a node to preview filtered results.
          </div>
        ) : !previewReady ? (
          <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
            Configure at least one complete condition to see a live preview of the filtered rows.
          </div>
        ) : previewError ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {previewError}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="overflow-x-auto border border-slate-200 rounded-md bg-white">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    {previewColumnsToRender.length > 0 ? (
                      previewColumnsToRender.map((col) => (
                        <th key={col} className="px-3 py-2 text-left font-semibold text-slate-700 whitespace-nowrap">
                          {col}
                        </th>
                      ))
                    ) : (
                      <th className="px-3 py-2 text-left font-semibold text-slate-700">No columns</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {previewLoading && previewData.length === 0 ? (
                    <tr>
                      <td colSpan={previewTableColSpan} className="px-3 py-6 text-center text-slate-500">
                        <span className="inline-flex items-center gap-2">
                          <svg className="animate-spin h-5 w-5 text-blue-600" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                          Loading preview…
                        </span>
                      </td>
                    </tr>
                  ) : previewData.length === 0 ? (
                    <tr>
                      <td colSpan={previewTableColSpan} className="px-3 py-6 text-center text-slate-500">
                        No rows match the current filters.
                      </td>
                    </tr>
                  ) : (
                    previewData.map((row, rowIndex) => (
                      <tr key={rowIndex} className="bg-white">
                        {previewColumnsToRender.map((col) => (
                          <td key={`${rowIndex}-${col}`} className="px-3 py-2 whitespace-nowrap text-slate-700 font-mono text-xs">
                            {formatPreviewValue((row as any)?.[col])}
                          </td>
                        ))}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-slate-600">
                {previewPagination
                  ? `${previewPagination.total_rows} row${previewPagination.total_rows === 1 ? '' : 's'} · page ${currentPreviewPage} of ${displayTotalPages}`
                  : 'Preview ready'}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handlePreviewPrev}
                  disabled={!previewPagination?.has_prev || previewLoading}
                  className="px-3 py-1 border border-slate-300 rounded-md text-sm bg-white disabled:bg-slate-100 disabled:text-slate-400"
                >
                  Previous
                </button>
                <span className="text-sm text-slate-600">
                  Page {currentPreviewPage}
                </span>
                <button
                  type="button"
                  onClick={handlePreviewNext}
                  disabled={!previewPagination?.has_next || previewLoading}
                  className="px-3 py-1 border border-slate-300 rounded-md text-sm bg-white disabled:bg-slate-100 disabled:text-slate-400"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default FilterTab;
