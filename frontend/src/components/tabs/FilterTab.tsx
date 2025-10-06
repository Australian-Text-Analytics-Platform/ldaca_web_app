import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { CalendarIcon, Clock2Icon, Loader2 } from 'lucide-react';
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
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Calendar } from '../ui/calendar';
// Define minimal request types (backend expects these shapes)
type ConditionRange = { start: string | Date | null; end: string | Date | null };
type ConditionValue = string | number | boolean | Date | ConditionRange | null;

interface FilterCondition {
  column: string;
  operator: 'eq' | 'gte' | 'lte' | 'contains' | 'startswith' | 'endswith' | 'is_null' | 'between';
  value: ConditionValue;
  negate?: boolean;
  regex?: boolean;
}
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
      className={`${parentClassName ? `${parentClassName} ` : ''}px-2 py-1 rounded-md border border-border text-sm font-mono text-foreground`}
      size={28}
      style={{ width: '28ch', minWidth: '28ch', maxWidth: '28ch', flex: 'none' }}
    />
  );
});

IsoDateInput.displayName = 'IsoDateInput';

const padNumber = (value: number): string => value.toString().padStart(2, '0');

const toIsoUtcString = (date: Date): string => {
  return `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}-${padNumber(date.getDate())}T${padNumber(date.getHours())}:${padNumber(date.getMinutes())}:${padNumber(date.getSeconds())}+00:00`;
};

const formatTimeInputValue = (date: Date | null | undefined): string => {
  if (!date) {
    return '00:00:00';
  }
  return `${padNumber(date.getHours())}:${padNumber(date.getMinutes())}:${padNumber(date.getSeconds())}`;
};

const parseTimeSegments = (value: string): [number, number, number] => {
  const [hours = '0', minutes = '0', seconds = '0'] = value.split(':');
  const parsedHours = Number(hours);
  const parsedMinutes = Number(minutes);
  const parsedSeconds = Number(seconds);
  return [Number.isFinite(parsedHours) ? parsedHours : 0, Number.isFinite(parsedMinutes) ? parsedMinutes : 0, Number.isFinite(parsedSeconds) ? parsedSeconds : 0];
};

const combineDateAndTime = (date: Date, timeValue: string): Date => {
  const [hours, minutes, seconds] = parseTimeSegments(timeValue);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hours, minutes, seconds, 0);
};

const normalizeTimeValue = (value: string): string => {
  const [hours, minutes, seconds] = parseTimeSegments(value);
  return `${padNumber(Math.max(0, Math.min(23, hours)))}:${padNumber(Math.max(0, Math.min(59, minutes)))}:${padNumber(Math.max(0, Math.min(59, seconds)))}`;
};

interface DateTimePickerFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

const DateTimePickerField: React.FC<DateTimePickerFieldProps> = ({ value, onChange, placeholder = ISO_PLACEHOLDER, disabled = false }) => {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = React.useState(false);
  const parsedValue = React.useMemo(() => (value ? parseIsoToLocalDate(value) : null), [value]);
  const [draftDate, setDraftDate] = React.useState<Date | undefined>(parsedValue ?? undefined);
  const [timeValue, setTimeValue] = React.useState<string>(formatTimeInputValue(parsedValue));
  const timeInputId = React.useId();

  React.useEffect(() => {
    setDraftDate(parsedValue ?? undefined);
    setTimeValue(formatTimeInputValue(parsedValue));
  }, [parsedValue, open]);

  React.useEffect(() => {
    if (!open) {
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const commitDate = useCallback(
    (date: Date | undefined) => {
      if (!date) {
        onChange('');
        return;
      }
      onChange(toIsoUtcString(date));
    },
    [onChange]
  );

  const handleSelectDate = useCallback(
    (day: Date | undefined) => {
      if (!day) {
        setDraftDate(undefined);
        commitDate(undefined);
        return;
      }
      const combined = combineDateAndTime(day, timeValue);
      setDraftDate(combined);
      commitDate(combined);
    },
    [commitDate, timeValue]
  );

  const handleTimeChange = useCallback(
    (nextValue: string) => {
      const normalized = normalizeTimeValue(nextValue);
      setTimeValue(normalized);
      setDraftDate((current) => {
        if (!current) {
          return current;
        }
        const updated = combineDateAndTime(current, normalized);
        commitDate(updated);
        return updated;
      });
    },
    [commitDate]
  );

  const selectedDate = draftDate ?? parsedValue ?? undefined;

  return (
    <div ref={containerRef} className="relative flex items-center">
      <IsoDateInput
        committedValue={value}
        onCommit={onChange}
        placeholder={placeholder}
        readOnly={disabled}
        className="pr-10"
        onFocus={() => {
          if (!disabled) {
            setOpen(true);
          }
        }}
        onClick={() => {
          if (!disabled) {
            setOpen(true);
          }
        }}
      />
      <CalendarIcon className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      {open && !disabled && (
        <div className="absolute left-0 top-full z-50 mt-2 w-max">
          <Card className="w-fit py-4 shadow-lg">
            <CardContent className="px-4">
              <Calendar
                mode="single"
                selected={selectedDate}
                defaultMonth={selectedDate ?? new Date()}
                onSelect={handleSelectDate}
                numberOfMonths={1}
                captionLayout="dropdown"
                className="bg-transparent p-0"
                formatters={{
                  formatMonthDropdown: (date) => date.toLocaleString('default', { month: 'long' }),
                }}
              />
            </CardContent>
            <CardFooter className="flex w-full flex-col gap-6 border-t px-4 !pt-4">
              <div className="flex w-full flex-col gap-3">
                <Label htmlFor={timeInputId}>Time</Label>
                <div className="relative flex w-full items-center">
                  <Clock2Icon className="pointer-events-none absolute left-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    id={timeInputId}
                    type="time"
                    step={1}
                    value={timeValue}
                    onChange={(event) => handleTimeChange(event.target.value)}
                    className="appearance-none pl-8 [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
                  />
                </div>
              </div>
            </CardFooter>
          </Card>
        </div>
      )}
    </div>
  );
};


// Extended interface for UI with tracking ID
interface FilterConditionWithId extends Omit<FilterCondition, 'value'> {
  id: string;
  dataType?: string;
  value: ConditionValue;
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

type PreviewRow = Record<string, unknown>;

const hasNonEmptyValue = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number' || typeof value === 'boolean') return true;
  if (value instanceof Date) return true;
  if (Array.isArray(value)) {
    return value.some((entry) => hasNonEmptyValue(entry));
  }
  if (typeof value === 'object') {
    const maybeRange = value as Partial<ConditionRange>;
    if ('start' in maybeRange || 'end' in maybeRange) {
      return hasNonEmptyValue(maybeRange.start) || hasNonEmptyValue(maybeRange.end);
    }
    return Object.values(value as Record<string, unknown>).some((entry) => hasNonEmptyValue(entry));
  }
  return true;
};

const serializeConditionsForRequest = (conditions: FilterConditionWithId[]) => {
  return conditions.map<FilterCondition>((condition) => {
    let value: ConditionValue;
    if (condition.operator === 'is_null') {
      value = null;
    } else if (condition.value instanceof Date) {
      value = condition.value.toISOString();
    } else if (condition.value && typeof condition.value === 'object' && 'start' in condition.value) {
      const range = condition.value as ConditionRange;
      const normalizeEdge = (edge: ConditionRange['start']): string | null => {
        if (!edge) return null;
        if (edge instanceof Date) return edge.toISOString();
        const trimmed = typeof edge === 'string' ? edge.trim() : '';
        return trimmed.length > 0 ? trimmed : null;
      };
      value = {
        start: normalizeEdge(range.start),
        end: normalizeEdge(range.end),
      };
    } else {
      const fallback = condition.value;
      value = fallback ?? '';
    }

    const payload: FilterCondition = {
      column: condition.column,
      operator: condition.operator,
      value,
    };

    if (condition.negate !== undefined) payload.negate = Boolean(condition.negate);
    if (condition.regex !== undefined) payload.regex = Boolean(condition.regex);

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

const formatPreviewValue = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value.map((item) => formatPreviewValue(item)).join(', ');
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
};

// Date-time picker now uses shadcn calendar + manual time inputs to produce ISO8601 strings.

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
  const [previewData, setPreviewData] = useState<PreviewRow[]>([]);
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

  const handlePreviewPageSizeChange = (value: string) => {
    const nextSize = Number(value);
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
        const rows: PreviewRow[] = Array.isArray(resp?.data) ? (resp.data as PreviewRow[]) : [];
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
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : 'Failed to load preview data';
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

  const handleConditionChange = <Key extends keyof FilterConditionWithId>(
    id: string,
    field: Key,
    value: FilterConditionWithId[Key]
  ) => {
          setConditions(conditions.map((c) => {
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
              prefillDatetimeValue(id, columnInfo.name, 'eq');
            }
          }
        }
        
        // If operator changed for datetime column, pre-fill value
        if (field === 'operator' && c.dataType === 'datetime' && c.column && selectedNodeId && currentWorkspaceId) {
          updated.value = ''; // Reset value first
          prefillDatetimeValue(id, c.column, value as FilterCondition['operator']);
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
          let newValue: ConditionValue = '';
          
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
                start: (describeData.min as ConditionRange['start']) || '',
                end: (describeData.max as ConditionRange['end']) || ''
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
      const renderPicker = (committedValue: string, commitValue: (next: string) => void) => {
        if (disabled) {
          return (
            <input
              type="text"
              value={committedValue}
              disabled
              placeholder={ISO_PLACEHOLDER}
              className="rounded-md border border-border/70 bg-muted px-2 py-1 font-mono text-sm text-muted-foreground"
            />
          );
        }

        return (
          <DateTimePickerField
            value={committedValue}
            onChange={commitValue}
            placeholder={ISO_PLACEHOLDER}
          />
        );
      };
      if (condition.operator === 'between') {
        const rangeValue: ConditionRange =
          condition.value && typeof condition.value === 'object' && 'start' in (condition.value as Record<string, unknown>)
            ? (condition.value as ConditionRange)
            : { start: null, end: null };
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
            <div className="flex-none">
              {renderPicker(startStr, (v) =>
                handleConditionChange(condition.id, 'value', {
                  start: v,
                  end: rangeValue.end ?? null,
                })
              )}
            </div>
            <div className="flex-none">
              {renderPicker(endStr, (v) =>
                handleConditionChange(condition.id, 'value', {
                  start: rangeValue.start ?? null,
                  end: v,
                })
              )}
            </div>
          </div>
        );
      }
      const singleVal =
        typeof condition.value === 'string'
          ? condition.value
          : condition.value instanceof Date
            ? condition.value.toISOString()
            : '';
      return renderPicker(singleVal, (v) => handleConditionChange(condition.id, 'value', v));
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
                          onCheckedChange={(checked) => handleConditionChange(condition.id, 'negate', checked === true)}
                          disabled={isConfigDisabled}
                        />
                        <span>negate</span>
                      </label>

                      {condition.dataType === 'string' && condition.operator === 'contains' && (
                        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Checkbox
                            id={`regex-${condition.id}`}
                            checked={Boolean(condition.regex ?? true)}
                            onCheckedChange={(checked) => handleConditionChange(condition.id, 'regex', checked === true)}
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
                        onValueChange={(value) =>
                          handleConditionChange(
                            condition.id,
                            'operator',
                            value as FilterCondition['operator']
                          )
                        }
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
                onValueChange={handlePreviewPageSizeChange}
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
                              {formatPreviewValue(row[col])}
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
