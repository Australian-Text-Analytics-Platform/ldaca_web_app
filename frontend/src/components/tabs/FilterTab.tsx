import React, { useState, useEffect, useMemo } from 'react';
import DatePicker from 'react-datepicker';
import type { ReactDatePickerCustomHeaderProps } from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { Loader2 } from 'lucide-react';
import { useWorkspaceSelection } from '../../hooks/useWorkspaceSelection';
import { useWorkspaceData } from '../../hooks/useWorkspaceData';
import { useWorkspaceActions } from '../../hooks/useWorkspaceActions';
import { useWorkspaceStatus } from '../../hooks/useWorkspaceStatus';
// Import nodesApi for filter operation (types redefined locally for UI)
import { nodesApi } from '../../api/nodes';
// Import shadcn components
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Checkbox } from '../ui/checkbox';
import { AlertDialog, AlertDialogAction, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../ui/alert-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../ui/card';
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

const MONTH_LABELS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const YEARS_PAST_WINDOW = 120;
const YEARS_FUTURE_WINDOW = 50;

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
    className={`${parentClassName ? `${parentClassName} ` : ''}px-2 py-1 rounded-md border border-border text-sm font-mono text-foreground`}
      size={28}
      style={{ width: '28ch', minWidth: '28ch', maxWidth: '28ch', flex: 'none' }}
    />
  );
});

export const CalendarHeaderWithYearSelect: React.FC<ReactDatePickerCustomHeaderProps> = ({
  date,
  decreaseMonth,
  increaseMonth,
  changeYear,
  changeMonth,
  prevMonthButtonDisabled,
  nextMonthButtonDisabled,
}) => {
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const headerRef = React.useRef<HTMLDivElement | null>(null);
  const monthListRef = React.useRef<HTMLDivElement | null>(null);
  const yearListRef = React.useRef<HTMLDivElement | null>(null);
  const selectedMonthRef = React.useRef<HTMLButtonElement | null>(null);
  const selectedYearRef = React.useRef<HTMLButtonElement | null>(null);

  React.useEffect(() => {
    if (!pickerOpen) return;
    const handler = (event: MouseEvent) => {
      if (!headerRef.current) return;
      if (!headerRef.current.contains(event.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
    };
  }, [pickerOpen]);

  React.useEffect(() => {
    setPickerOpen(false);
  }, [date]);

  // Scroll to selected month and year when menu opens
  React.useEffect(() => {
    if (pickerOpen) {
      if (monthListRef.current && selectedMonthRef.current) {
        const list = monthListRef.current;
        const selected = selectedMonthRef.current;
        const listHeight = list.clientHeight;
        const selectedTop = selected.offsetTop;
        const selectedHeight = selected.clientHeight;
        // Center the selected month in the list
        list.scrollTop = selectedTop - (listHeight / 2) + (selectedHeight / 2);
      }
      if (yearListRef.current && selectedYearRef.current) {
        const list = yearListRef.current;
        const selected = selectedYearRef.current;
        const listHeight = list.clientHeight;
        const selectedTop = selected.offsetTop;
        const selectedHeight = selected.clientHeight;
        // Center the selected year in the list
        list.scrollTop = selectedTop - (listHeight / 2) + (selectedHeight / 2);
      }
    }
  }, [pickerOpen]);

  const years = React.useMemo(() => {
    const currentYear = date.getFullYear();
    const todayYear = new Date().getFullYear();
    const lowerBound = Math.min(currentYear - YEARS_PAST_WINDOW, todayYear - YEARS_PAST_WINDOW);
    const upperBound = Math.max(currentYear + YEARS_FUTURE_WINDOW, todayYear + YEARS_FUTURE_WINDOW);
    const list: number[] = [];
    for (let year = lowerBound; year <= upperBound; year += 1) {
      list.push(year);
    }
    return list;
  }, [date]);

  const handleTogglePicker = () => {
    setPickerOpen(open => !open);
  };

  const handleSelectMonth = (monthIndex: number) => {
    changeMonth(monthIndex);
    setPickerOpen(false);
  };

  const handleSelectYear = (year: number) => {
    changeYear(year);
    setPickerOpen(false);
  };

  const handleDecreaseMonth = (e: React.MouseEvent) => {
    e.stopPropagation();
    setPickerOpen(false);
    decreaseMonth();
  };

  const handleIncreaseMonth = (e: React.MouseEvent) => {
    e.stopPropagation();
    setPickerOpen(false);
    increaseMonth();
  };

  return (
    <div ref={headerRef} className="flex items-center justify-between px-2 py-1 text-muted-foreground">
      <button
        type="button"
        onClick={handleDecreaseMonth}
        disabled={prevMonthButtonDisabled}
        className="rounded-md p-1 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-40"
        aria-label="Previous month"
      >
        ‹
      </button>
      <div className="relative flex-1">
        <button
          type="button"
          onClick={handleTogglePicker}
          className="w-full rounded-md px-2 py-1 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          aria-haspopup="dialog"
          aria-expanded={pickerOpen}
          aria-label="Select month and year"
        >
          {MONTH_LABELS[date.getMonth()]} {date.getFullYear()}
        </button>
        {pickerOpen && (
          <div
            role="dialog"
            className="absolute left-1/2 z-10 mt-1 flex -translate-x-1/2 gap-2 rounded-md border border-border bg-card p-2 shadow-lg"
          >
            {/* Month column */}
            <div
              ref={monthListRef}
              role="listbox"
              aria-label="Select month"
              className="max-h-64 w-32 overflow-y-auto rounded-md border border-border/70 bg-card py-1"
            >
              {MONTH_LABELS.map((month, index) => (
                <button
                  key={month}
                  ref={index === date.getMonth() ? selectedMonthRef : null}
                  type="button"
                  role="option"
                  aria-selected={index === date.getMonth()}
                  className={`block w-full px-3 py-1.5 text-left text-sm ${
                    index === date.getMonth()
                      ? 'bg-primary/10 font-semibold text-primary'
                      : 'hover:bg-muted'
                  }`}
                  onClick={() => handleSelectMonth(index)}
                >
                  {month}
                </button>
              ))}
            </div>
            {/* Year column */}
            <div
              ref={yearListRef}
              role="listbox"
              aria-label="Select year"
              className="max-h-64 w-24 overflow-y-auto rounded-md border border-border/70 bg-card py-1"
            >
              {years.map(year => (
                <button
                  key={year}
                  ref={year === date.getFullYear() ? selectedYearRef : null}
                  type="button"
                  role="option"
                  aria-selected={year === date.getFullYear()}
                  className={`block w-full px-3 py-1.5 text-left text-sm ${
                    year === date.getFullYear()
                      ? 'bg-primary/10 font-semibold text-primary'
                      : 'hover:bg-muted'
                  }`}
                  onClick={() => handleSelectYear(year)}
                >
                  {year}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={handleIncreaseMonth}
        disabled={nextMonthButtonDisabled}
        className="rounded-md p-1 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-40"
        aria-label="Next month"
      >
        ›
      </button>
    </div>
  );
};

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
  const { nodeData, currentWorkspaceId } = useWorkspaceData();
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
  // AlertDialog state
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertMessage, setAlertMessage] = useState('');

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
            
            // Pre-fill datetime values if datetime column
            if (columnInfo.dataType === 'datetime' && selectedNodeId && currentWorkspaceId) {
              prefillDatetimeValue(id, value, 'eq');
            }
          }
        }
        
        // If operator changed for datetime column, pre-fill value
        if (field === 'operator' && c.dataType === 'datetime' && c.column && selectedNodeId && currentWorkspaceId) {
          updated.value = ''; // Reset value first
          prefillDatetimeValue(id, c.column, value as string);
        }
        
        return updated;
      }
      return c;
    }));
  };

  // Pre-fill datetime values based on operator and column statistics
  const prefillDatetimeValue = async (conditionId: string, column: string, operator: string) => {
    if (!selectedNodeId || !currentWorkspaceId) return;
    
    try {
      const describeData = await nodesApi.describeColumn(currentWorkspaceId, selectedNodeId, column);
      
      setConditions(prev => prev.map(c => {
        if (c.id === conditionId) {
          let newValue: any = '';
          
          switch (operator) {
            case 'eq':
              // Pre-fill with median
              newValue = describeData.median || describeData.min || '';
              break;
            case 'gte':
              // Pre-fill with earliest (min)
              newValue = describeData.min || '';
              break;
            case 'lte':
              // Pre-fill with latest (max)
              newValue = describeData.max || '';
              break;
            case 'between':
              // Pre-fill with min and max
              newValue = {
                start: describeData.min || '',
                end: describeData.max || ''
              };
              break;
            default:
              newValue = '';
          }
          
          return { ...c, value: newValue };
        }
        return c;
      }));
    } catch (error) {
      console.error('Failed to fetch describe data for pre-filling:', error);
      // Don't show error to user, just fail silently
    }
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
          className="flex-1 rounded-md border border-border/70 bg-muted px-2 py-1 text-sm text-muted-foreground"
        />
      );
    }

    const dataType = condition.dataType || 'string';

    if (dataType === 'boolean') {
      return (
        <Select
          value={String(condition.value)}
          onValueChange={(value) => handleConditionChange(condition.id, 'value', value === 'true')}
          disabled={disabled}
        >
          <SelectTrigger className="flex-1">
            <SelectValue placeholder="Select value" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="true">True</SelectItem>
            <SelectItem value="false">False</SelectItem>
          </SelectContent>
        </Select>
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
            className="rounded-md border border-border/70 bg-muted px-2 py-1 font-mono text-sm text-muted-foreground"
          />
        ) : (
          <DatePicker
            selected={committedDate || undefined}
            openToDate={committedDate || undefined}
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
            renderCustomHeader={(headerProps) => (
              <CalendarHeaderWithYearSelect {...headerProps} />
            )}
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
          className="flex-1 rounded-md border border-input px-2 py-1 text-sm text-foreground"
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
  className="flex-1 rounded-md border border-input px-2 py-1 text-sm text-foreground"
        disabled={disabled}
      />
    );
  };

  const handleApplyFilter = async () => {
    if (!selectedNodeId) {
      setAlertMessage('Please select a node first');
      setAlertOpen(true);
      return;
    }

  if (conditions.length === 0 || conditions.some((condition) => !isConditionComplete(condition))) {
      setAlertMessage('Please fill in all filter conditions');
      setAlertOpen(true);
      return;
    }

    const request: FilterRequest = buildFilterRequestPayload(conditions, logic, newNodeName);

    try {
      setIsFiltering(true);
      await filterNode(selectedNodeId, request);
      // Success - the graph should automatically refresh due to query invalidation
    } catch (error) {
      console.error('Filter error:', error);
      setAlertMessage(`Error applying filter: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setAlertOpen(true);
    } finally {
      setIsFiltering(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="space-y-0 pb-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle>Filter &amp; Slice Data</CardTitle>
              <CardDescription>Apply column-based filters to create a new node from the selected dataset.</CardDescription>
            </div>
            {isFiltering && (
              <span className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-border bg-muted/60 px-3 py-1 text-xs font-medium text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Running…
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-6 pt-0">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-muted-foreground">
                Selected Node ({hasSelection ? 1 : 0}/1)
              </span>
            </div>
            {!hasSelection ? (
              <div className="rounded-md border border-dashed border-muted-foreground/40 bg-muted/40 p-3 text-sm italic text-muted-foreground">
                No nodes selected. Single click on a node in the workspace view to select it (max 1 for this operation).
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-lg border border-border bg-muted/40 p-4">
                  <div className="text-sm font-medium text-foreground break-words">
                    {selectedNode?.data?.nodeName || selectedNode?.data?.label || selectedNode?.data?.name || selectedNode?.label || selectedNode?.id || selectedNodeId}
                  </div>
                  <div className="text-xs text-muted-foreground break-all">{selectedNodeId}</div>
                </div>

                {isSchemaLoading ? (
                  <div className="rounded-md border border-dashed border-amber-400/60 bg-amber-100/70 p-4 text-sm text-amber-900">
                    Loading column metadata…
                  </div>
                ) : hasSchema ? (
                  <div className="space-y-2">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Schema</div>
                    <div className="overflow-x-auto rounded-md border border-border bg-card">
                      <Table>
                        <TableBody>
                          <TableRow>
                            {availableColumns.map((col) => (
                              <TableCell
                                key={`${col.name}-name`}
                                className="min-w-[6rem] border-b border-border px-2 py-1 font-mono text-[11px] font-semibold text-foreground"
                              >
                                {col.name}
                              </TableCell>
                            ))}
                          </TableRow>
                          <TableRow>
                            {availableColumns.map((col) => (
                              <TableCell
                                key={`${col.name}-type`}
                                className="min-w-[6rem] px-2 py-1 font-mono text-[11px] text-muted-foreground"
                              >
                                {col.dataType}
                              </TableCell>
                            ))}
                          </TableRow>
                        </TableBody>
                      </Table>
                    </div>
                    <div className="text-[10px] text-muted-foreground">Scroll horizontally to view all {availableColumns.length} column(s).</div>
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed border-amber-400/60 bg-amber-100/70 p-4 text-sm text-amber-900">
                    No schema information is available for this node yet.
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <h3 className="text-base font-semibold text-foreground">Filter conditions</h3>
              <Button onClick={handleAddCondition} disabled={isConfigDisabled} size="sm">
                Add condition
              </Button>
            </div>

            {hasSelection && isSchemaLoading && (
              <div className="rounded-md border border-dashed border-amber-400/60 bg-amber-100/70 p-4 text-sm text-amber-900">
                Retrieving column information…
              </div>
            )}

            {!hasSelection && (
              <div className="rounded-md border border-dashed border-muted-foreground/40 bg-muted/40 p-4 text-sm text-muted-foreground">
                Configure conditions once a node is selected.
              </div>
            )}

            <div className="space-y-3">
              {conditions.map((condition, index) => {
                const rowDisabled = isConfigDisabled || !condition.column;
                return (
                  <div
                    key={condition.id}
                    className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-3 md:flex-row md:items-center md:gap-3"
                  >
                    <div className="flex items-center gap-2 md:w-auto">
                      {index > 0 && (
                        <Select
                          value={logic}
                          onValueChange={(value) => setLogic(value as 'and' | 'or')}
                          disabled={isConfigDisabled}
                        >
                          <SelectTrigger className="w-20">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="and">AND</SelectItem>
                            <SelectItem value="or">OR</SelectItem>
                          </SelectContent>
                        </Select>
                      )}

                      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Checkbox
                          id={`negate-${condition.id}`}
                          checked={Boolean(condition.negate)}
                          onCheckedChange={(checked) => handleConditionChange(condition.id, 'negate' as any, checked)}
                          disabled={isConfigDisabled}
                        />
                        <span>negate</span>
                      </label>

                      {condition.dataType === 'string' && condition.operator === 'contains' && (
                        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Checkbox
                            id={`regex-${condition.id}`}
                            checked={Boolean(condition.regex ?? true)}
                            onCheckedChange={(checked) => handleConditionChange(condition.id, 'regex' as any, checked)}
                            disabled={isConfigDisabled}
                          />
                          <span>regex</span>
                        </label>
                      )}
                    </div>

                    <div className="flex flex-1 flex-col gap-2 md:flex-row md:flex-wrap md:items-center md:gap-x-3 md:gap-y-2">
                      <Select
                        value={condition.column}
                        onValueChange={(value) => handleConditionChange(condition.id, 'column', value)}
                        disabled={isConfigDisabled}
                      >
                        <SelectTrigger className="min-w-[10rem] flex-grow">
                          <SelectValue placeholder="Select column" />
                        </SelectTrigger>
                        <SelectContent>
                          {availableColumns.map((col) => (
                            <SelectItem key={col.name} value={col.name}>
                              {col.name} ({col.dataType})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <Select
                        value={condition.operator}
                        onValueChange={(value) => handleConditionChange(condition.id, 'operator', value)}
                        disabled={rowDisabled}
                      >
                        <SelectTrigger className="w-36 flex-none">
                          <SelectValue placeholder={!condition.column ? 'Select a column first' : 'Select operator'} />
                        </SelectTrigger>
                        <SelectContent>
                          {condition.column &&
                            getOperatorsForType(condition.dataType || 'string').map((op) => (
                              <SelectItem key={op.value} value={op.value}>
                                {op.label}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>

                      {condition.operator !== 'is_null' && (
                        <div className="flex-1 md:flex-auto md:min-w-[28ch] md:max-w-full">
                          {renderValueInput(condition, rowDisabled)}
                        </div>
                      )}
                    </div>

                    {conditions.length > 1 && (
                      <Button
                        onClick={() => handleRemoveCondition(condition.id)}
                        variant="destructive"
                        size="sm"
                        type="button"
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-muted-foreground" htmlFor="filter-new-node-name">
              New node name
            </label>
            <input
              id="filter-new-node-name"
              type="text"
              value={newNodeName}
              onChange={(e) => setNewNodeName(e.target.value)}
              placeholder="Enter name for filtered data"
              disabled={!hasSelection}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
        </CardContent>
        <CardFooter className="flex flex-col gap-3 border-t border-border bg-muted/20 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-muted-foreground">
            {conditions.length === 0
              ? 'Define at least one condition to enable preview and filtering.'
              : `${conditions.length} condition${conditions.length === 1 ? '' : 's'} configured (${logic.toUpperCase()} logic).`}
          </div>
          <Button
            onClick={handleApplyFilter}
            disabled={isConfigDisabled || isFiltering || isLoading.operations}
            className="w-full sm:w-auto"
          >
            {isFiltering ? 'Adding to workspace…' : 'Add to Workspace'}
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader className="space-y-0 pb-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>Preview filtered rows</CardTitle>
              <CardDescription>Review rows that match the current filter configuration.</CardDescription>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <label htmlFor="filter-preview-page-size" className="text-sm text-muted-foreground">
                Rows per page
              </label>
              <Select
                value={String(previewPageSize)}
                onValueChange={(value) => handlePreviewPageSizeChange({ target: { value } } as any)}
                disabled={!previewReady || previewLoading}
              >
                <SelectTrigger className="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PREVIEW_PAGE_SIZE_OPTIONS.map((option) => (
                    <SelectItem key={option} value={String(option)}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          {!hasSelection ? (
            <div className="rounded-md border border-dashed border-muted-foreground/40 bg-muted/40 p-4 text-sm text-muted-foreground">
              Select a node to preview filtered results.
            </div>
          ) : !previewReady ? (
            <div className="rounded-md border border-dashed border-muted-foreground/40 bg-muted/40 p-4 text-sm text-muted-foreground">
              Configure at least one complete condition to see a live preview of the filtered rows.
            </div>
          ) : previewError ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
              {previewError}
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-muted/40">
                    <TableRow>
                      {previewColumnsToRender.length > 0 ? (
                        previewColumnsToRender.map((col) => (
                          <TableHead
                            key={col}
                            className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground"
                          >
                            {col}
                          </TableHead>
                        ))
                      ) : (
                        <TableHead className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          No columns
                        </TableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewLoading && previewData.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={previewTableColSpan} className="px-3 py-6 text-center text-muted-foreground">
                          <span className="inline-flex items-center gap-2">
                            <Loader2 className="h-5 w-5 animate-spin text-primary" />
                            Loading preview…
                          </span>
                        </TableCell>
                      </TableRow>
                    ) : previewData.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={previewTableColSpan} className="px-3 py-6 text-center text-muted-foreground">
                          No rows match the current filters.
                        </TableCell>
                      </TableRow>
                    ) : (
                      previewData.map((row, rowIndex) => (
                        <TableRow key={rowIndex}>
                          {previewColumnsToRender.map((col) => (
                            <TableCell
                              key={`${rowIndex}-${col}`}
                              className="px-3 py-2 font-mono text-xs text-foreground"
                            >
                              {formatPreviewValue((row as any)?.[col])}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </CardContent>
        {previewReady && !previewError && previewData.length > 0 && (
          <CardFooter className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/20 py-4">
            <div className="text-sm text-muted-foreground">
              {previewPagination
                ? `${previewPagination.total_rows} row${previewPagination.total_rows === 1 ? '' : 's'} · page ${currentPreviewPage} of ${displayTotalPages}`
                : 'Preview ready'}
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                onClick={handlePreviewPrev}
                disabled={!previewPagination?.has_prev || previewLoading}
                variant="outline"
                size="sm"
              >
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">Page {currentPreviewPage}</span>
              <Button
                type="button"
                onClick={handlePreviewNext}
                disabled={!previewPagination?.has_next || previewLoading}
                variant="outline"
                size="sm"
              >
                Next
              </Button>
            </div>
          </CardFooter>
        )}
      </Card>

      {/* Alert Dialog for error messages */}
      <AlertDialog open={alertOpen} onOpenChange={setAlertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Alert</AlertDialogTitle>
            <AlertDialogDescription>
              {alertMessage}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setAlertOpen(false)}>OK</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default FilterTab;
