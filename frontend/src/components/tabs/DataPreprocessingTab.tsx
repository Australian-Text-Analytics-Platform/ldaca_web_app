import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Calendar } from '../ui/calendar';
import NodeSelectionPanel, { NodeColumnSelection, WorkspaceNodeLike } from '../NodeSelectionPanel';
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

type DataPrepSubtab = 'filter' | 'slice' | 'join' | 'concat' | 'aggregate';

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
const MAX_CONCAT_NODES = 6;

type PreviewRow = Record<string, unknown>;

type JoinType = 'inner' | 'left' | 'right' | 'full' | 'semi' | 'anti' | 'cross';

const JOIN_TYPE_OPTIONS: Array<{ value: JoinType; description: string }> = [
  {
    value: 'inner',
    description: 'Only rows with matching keys in both nodes.',
  },
  {
    value: 'left',
    description: 'All rows from the left node plus matching rows from the right.',
  },
  {
    value: 'right',
    description: 'All rows from the right node plus matching rows from the left.',
  },
  {
    value: 'full',
    description: 'All rows from both nodes; missing matches become nulls.',
  },
  {
    value: 'semi',
    description: 'Rows from the left node that have at least one match in the right.',
  },
  {
    value: 'anti',
    description: 'Rows from the left node that do not match anything in the right.',
  },
  {
    value: 'cross',
    description: 'Cartesian product of all rows; ignores column selections.',
  },
];

interface JoinPreviewRequestSignature {
  leftNodeId: string;
  rightNodeId: string;
  leftOn?: string;
  rightOn?: string;
  joinType: JoinType;
  page: number;
  pageSize: number;
}

interface ConcatPreviewRequestSignature {
  nodeIds: string[];
  page: number;
  pageSize: number;
}

interface ConcatNodeSummary {
  nodeId: string;
  displayName: string;
  columns: string[];
  normalizedColumns: string[];
  dtypes: Record<string, string>;
  rawDtypes: Record<string, string>;
  columnCount: number;
}

interface ConcatSchemaAnalysis {
  summaries: ConcatNodeSummary[];
  ready: boolean;
  issues: string;
  mismatches: Array<{ nodeId: string; nodeName: string; details: string[] }>;
  baseColumns: string[];
  baseColumnCount: number;
}

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

const DataPreprocessingTab: React.FC = () => {
  const { selectedNodeId, selectedNode, selectedNodes, selectedNodeIds } = useWorkspaceSelection();
  const { nodeData, currentWorkspaceId, nodes: workspaceNodes = [], getNodeShape } = useWorkspaceData();
  const { filterNode, filterPreview, joinNodes, concatNodes, concatPreview } = useWorkspaceActions();
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
  const [activeSubtab, setActiveSubtab] = useState<DataPrepSubtab>('filter');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [debouncedRequest, setDebouncedRequest] = useState<{ request: FilterRequest; signature: string } | null>(null);
  // AlertDialog state
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertMessage, setAlertMessage] = useState('');


  const [joinLeftNodeId, setJoinLeftNodeId] = useState('');
  const [joinRightNodeId, setJoinRightNodeId] = useState('');
  const [joinLeftColumn, setJoinLeftColumn] = useState('');
  const [joinRightColumn, setJoinRightColumn] = useState('');
  const [joinType, setJoinType] = useState<JoinType>('inner');
  const [joinNewNodeName, setJoinNewNodeName] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const [joinPreviewPage, setJoinPreviewPage] = useState(1);
  const [joinPreviewPageSize, setJoinPreviewPageSize] = useState(10);
  const [joinPreviewData, setJoinPreviewData] = useState<PreviewRow[]>([]);
  const [joinPreviewColumns, setJoinPreviewColumns] = useState<string[]>([]);
  const [joinPreviewPagination, setJoinPreviewPagination] = useState<PreviewPagination | null>(null);
  const [joinPreviewLoading, setJoinPreviewLoading] = useState(false);
  const [joinPreviewError, setJoinPreviewError] = useState<string | null>(null);
  const [joinDebouncedRequest, setJoinDebouncedRequest] = useState<JoinPreviewRequestSignature | null>(null);
  const joinNameAutofillRef = useRef<string>('');

  const [concatNewNodeName, setConcatNewNodeName] = useState('');
  const [isConcatenating, setIsConcatenating] = useState(false);
  const [concatPreviewPage, setConcatPreviewPage] = useState(1);
  const [concatPreviewPageSize, setConcatPreviewPageSize] = useState(10);
  const [concatPreviewData, setConcatPreviewData] = useState<PreviewRow[]>([]);
  const [concatPreviewColumns, setConcatPreviewColumns] = useState<string[]>([]);
  const [concatPreviewPagination, setConcatPreviewPagination] = useState<PreviewPagination | null>(null);
  const [concatPreviewLoading, setConcatPreviewLoading] = useState(false);
  const [concatPreviewError, setConcatPreviewError] = useState<string | null>(null);
  const [concatDebouncedRequest, setConcatDebouncedRequest] = useState<ConcatPreviewRequestSignature | null>(null);
  const concatNameAutofillRef = useRef<string>('');

  const deriveNodeLabel = useCallback((node: WorkspaceNodeLike | null | undefined): string => {
    if (!node) return '';
    const data = (node?.data ?? {}) as Record<string, unknown>;
    return (
      (node as Record<string, unknown>).name as string | undefined ??
      (data.nodeName as string | undefined) ??
      (data.label as string | undefined) ??
      ((node as Record<string, unknown>).label as string | undefined) ??
      (node.id as string | undefined) ??
      ((node as Record<string, unknown>).node_id as string | undefined) ??
      ''
    );
  }, []);

  const workspaceNodeMap = useMemo(() => {
    const map = new Map<string, WorkspaceNodeLike>();
    workspaceNodes.forEach((node: WorkspaceNodeLike) => {
      const key = (node.id as string | undefined) ?? ((node as Record<string, unknown>).node_id as string | undefined);
      if (key) {
        map.set(key, node);
      }
    });
    return map;
  }, [workspaceNodes]);

  const filterSelectedNodesForPanel = useMemo<WorkspaceNodeLike[]>(() => {
    if (!selectedNodeId) return [];
    const node = workspaceNodeMap.get(selectedNodeId);
    return node ? [node] : [];
  }, [selectedNodeId, workspaceNodeMap]);

  const filterDefaultPalette = useMemo(
    () => ['#2563eb', '#dc2626', '#16a34a', '#f97316', '#d946ef', '#0ea5e9'],
    [],
  );

  const filterNodeColors = useMemo(() => {
    if (!selectedNodeId) return {} as Record<string, string>;
    return { [selectedNodeId]: filterDefaultPalette[0] ?? '#2563eb' };
  }, [selectedNodeId, filterDefaultPalette]);

  const filterNodeSelections = useMemo<NodeColumnSelection[]>(() => (
    selectedNodeId ? [{ nodeId: selectedNodeId, column: '' }] : []
  ), [selectedNodeId]);

  const joinLeftNode = joinLeftNodeId ? workspaceNodeMap.get(joinLeftNodeId) : undefined;
  const joinRightNode = joinRightNodeId ? workspaceNodeMap.get(joinRightNodeId) : undefined;

  const joinNeedsColumns = joinType !== 'cross';

  const getNodeColumnsForJoin = useCallback((nodeId: string): string[] => {
    const node = workspaceNodeMap.get(nodeId);
    if (!node) return [];
    const data = (node.data ?? {}) as Record<string, unknown>;
    if (Array.isArray(data.columns)) {
      return (data.columns as unknown[]).map((entry) => String(entry));
    }
    if (data.dtypes && typeof data.dtypes === 'object') {
      return Object.keys(data.dtypes as Record<string, unknown>);
    }
    if (data.schema && typeof data.schema === 'object') {
      return Object.keys(data.schema as Record<string, unknown>);
    }
    return [];
  }, [workspaceNodeMap]);

  const joinDefaultPalette = useMemo(
    () => ['#2563eb', '#dc2626', '#16a34a', '#f97316', '#d946ef', '#0ea5e9'],
    [],
  );

  const joinNodeSelections = useMemo<NodeColumnSelection[]>(() => {
    const selections: NodeColumnSelection[] = [];
    if (joinLeftNodeId) {
      selections.push({ nodeId: joinLeftNodeId, column: joinLeftColumn });
    }
    if (joinRightNodeId && joinRightNodeId !== joinLeftNodeId) {
      selections.push({ nodeId: joinRightNodeId, column: joinRightColumn });
    }
    return selections;
  }, [joinLeftNodeId, joinLeftColumn, joinRightNodeId, joinRightColumn]);

  const joinNodeColors = useMemo(() => {
    const colors: Record<string, string> = {};
    if (joinLeftNodeId) colors[joinLeftNodeId] = '#2563eb';
    if (joinRightNodeId) colors[joinRightNodeId] = '#dc2626';
    return colors;
  }, [joinLeftNodeId, joinRightNodeId]);

  const getNodeKeyFromNode = useCallback((node: WorkspaceNodeLike): string => {
    return (
      (node.id as string | undefined) ??
      (node.node_id as string | undefined) ??
      ((node.data as Record<string, unknown> | undefined)?.id as string | undefined) ??
      ((node.data as Record<string, unknown> | undefined)?.node_id as string | undefined) ??
      ''
    );
  }, []);

  const joinSelectedNodesForPanel = useMemo<WorkspaceNodeLike[]>(() => {
    const nodes: WorkspaceNodeLike[] = [];
    selectedNodeIds.slice(0, 2).forEach((nodeId) => {
      const node = workspaceNodeMap.get(nodeId);
      if (node) {
        nodes.push(node);
      }
    });
    return nodes;
  }, [selectedNodeIds, workspaceNodeMap]);

  const joinConfigReady = Boolean(
    joinLeftNode &&
    joinRightNode &&
    joinLeftNodeId &&
    joinRightNodeId &&
    joinLeftNodeId !== joinRightNodeId &&
    (!joinNeedsColumns || (joinLeftColumn && joinRightColumn))
  );

  const joinPreviewReady = activeSubtab === 'join' && joinConfigReady;

  const joinPreviewColumnsToRender = useMemo(() => {
    if (joinPreviewColumns.length > 0) return joinPreviewColumns;
    if (joinPreviewData.length > 0 && typeof joinPreviewData[0] === 'object' && joinPreviewData[0] !== null) {
      return Object.keys(joinPreviewData[0]);
    }
    return [];
  }, [joinPreviewColumns, joinPreviewData]);

  const joinPreviewTableColSpan = Math.max(joinPreviewColumnsToRender.length, 1);
  const joinPreviewCurrentPage = joinPreviewPagination?.page ?? joinPreviewPage;
  const joinDisplayTotalPages = joinPreviewPagination?.total_pages ?? Math.max(1, joinPreviewCurrentPage);

  const joinSharedColumns = useMemo(() => {
    if (!joinLeftNodeId || !joinRightNodeId) return [] as string[];
    const leftColumns = getNodeColumnsForJoin(joinLeftNodeId);
    const rightColumns = getNodeColumnsForJoin(joinRightNodeId);
    return leftColumns.filter((column) => rightColumns.includes(column));
  }, [joinLeftNodeId, joinRightNodeId, getNodeColumnsForJoin]);

  const joinConfigIssues = useMemo(() => {
    if (!joinLeftNodeId || !joinRightNodeId) {
      return 'Pick two nodes to configure a join.';
    }
    if (joinLeftNodeId === joinRightNodeId) {
      return 'Select two different nodes to join—joining a node to itself is not supported yet.';
    }
    if (joinNeedsColumns && (!joinLeftColumn || !joinRightColumn)) {
      return 'Choose the columns that should match between the two nodes.';
    }
    if (joinNeedsColumns && joinSharedColumns.length === 0) {
      return 'No matching column names detected. Select compatible columns manually or rename them to match.';
    }
    return '';
  }, [joinLeftNodeId, joinRightNodeId, joinNeedsColumns, joinLeftColumn, joinRightColumn, joinSharedColumns]);

  const joinStatusMessage = useMemo(() => {
    if (joinConfigReady) {
      if (joinNeedsColumns) {
        return `Ready to join ${deriveNodeLabel(joinLeftNode)} and ${deriveNodeLabel(joinRightNode)} on ${joinLeftColumn} = ${joinRightColumn}.`;
      }
        return `Ready to run a ${joinType} join between ${deriveNodeLabel(joinLeftNode)} and ${deriveNodeLabel(joinRightNode)}.`;
    }
    return joinConfigIssues || 'Configure the join to preview results.';
  }, [joinConfigReady, joinNeedsColumns, joinLeftNode, joinRightNode, joinLeftColumn, joinRightColumn, joinType, deriveNodeLabel, joinConfigIssues]);

  const currentJoinTypeInfo = useMemo(() => JOIN_TYPE_OPTIONS.find((option) => option.value === joinType), [joinType]);

  const handleJoinColorChange = useCallback(() => undefined, []);
  const handleFilterColorChange = useCallback(() => undefined, []);

  const handleJoinColumnChange = useCallback((nodeId: string, column: string) => {
    if (nodeId === joinLeftNodeId) {
      setJoinLeftColumn(column);
    } else if (nodeId === joinRightNodeId) {
      setJoinRightColumn(column);
    }
  }, [joinLeftNodeId, joinRightNodeId]);

  const handleFilterColumnChange = useCallback(() => undefined, []);

  const handleJoinPreviewPrev = useCallback(() => {
    if (joinPreviewPagination?.has_prev && !joinPreviewLoading) {
      setJoinPreviewPage((prev) => Math.max(1, prev - 1));
    }
  }, [joinPreviewPagination, joinPreviewLoading]);

  const handleJoinPreviewNext = useCallback(() => {
    if (joinPreviewPagination?.has_next && !joinPreviewLoading) {
      setJoinPreviewPage((prev) => prev + 1);
    }
  }, [joinPreviewPagination, joinPreviewLoading]);

  const handleJoinPreviewPageSizeChange = useCallback((value: string) => {
    const nextSize = Number(value);
    if (!Number.isNaN(nextSize)) {
      setJoinPreviewPageSize(nextSize);
      setJoinPreviewPage(1);
    }
  }, []);

  const autoJoinName = useMemo(() => {
    if (!joinLeftNodeId || !joinRightNodeId || joinLeftNodeId === joinRightNodeId) return '';
    const leftName = deriveNodeLabel(joinLeftNode);
    const rightName = deriveNodeLabel(joinRightNode);
    if (!leftName || !rightName) return '';
    return `${leftName}_${joinType}_join_${rightName}`.replace(/\s+/g, '_');
  }, [joinLeftNodeId, joinRightNodeId, joinLeftNode, joinRightNode, joinType, deriveNodeLabel]);

  useEffect(() => {
    joinNameAutofillRef.current = autoJoinName || '';
  }, [autoJoinName]);

  useEffect(() => {
    const nextLeft = selectedNodeIds[0] ?? '';
    const nextRight = selectedNodeIds[1] ?? '';

    setJoinLeftNodeId((prev) => (prev === nextLeft ? prev : nextLeft));
    setJoinRightNodeId((prev) => (prev === nextRight ? prev : nextRight));
  }, [selectedNodeIds]);

  useEffect(() => {
    if (joinType === 'cross') {
      setJoinLeftColumn('');
      setJoinRightColumn('');
      return;
    }
    const leftColumns = joinLeftNodeId ? getNodeColumnsForJoin(joinLeftNodeId) : [];
    const rightColumns = joinRightNodeId ? getNodeColumnsForJoin(joinRightNodeId) : [];
    if (!leftColumns.length || !rightColumns.length) {
      setJoinLeftColumn('');
      setJoinRightColumn('');
      return;
    }
    const common = leftColumns.filter((column) => rightColumns.includes(column));
    setJoinLeftColumn((prev) => (prev && leftColumns.includes(prev) ? prev : common[0] ?? leftColumns[0] ?? ''));
    setJoinRightColumn((prev) => (prev && rightColumns.includes(prev) ? prev : common[0] ?? rightColumns[0] ?? ''));
  }, [joinLeftNodeId, joinRightNodeId, joinType, getNodeColumnsForJoin]);

  useEffect(() => {
    setJoinPreviewPage(1);
  }, [joinLeftNodeId, joinRightNodeId, joinLeftColumn, joinRightColumn, joinType]);

  const joinPreviewParams = useMemo<JoinPreviewRequestSignature | null>(() => {
    if (!joinPreviewReady) return null;
    return {
      leftNodeId: joinLeftNodeId,
      rightNodeId: joinRightNodeId,
      leftOn: joinNeedsColumns ? joinLeftColumn : undefined,
      rightOn: joinNeedsColumns ? joinRightColumn : undefined,
      joinType,
      page: joinPreviewPage,
      pageSize: joinPreviewPageSize,
    };
  }, [joinPreviewReady, joinLeftNodeId, joinRightNodeId, joinNeedsColumns, joinLeftColumn, joinRightColumn, joinType, joinPreviewPage, joinPreviewPageSize]);

  useEffect(() => {
    if (activeSubtab !== 'join') {
      setJoinDebouncedRequest(null);
      setJoinPreviewLoading(false);
      return;
    }
    if (!joinPreviewParams) {
      setJoinDebouncedRequest(null);
      setJoinPreviewData([]);
      setJoinPreviewColumns([]);
      setJoinPreviewPagination(null);
      setJoinPreviewError(null);
      setJoinPreviewLoading(false);
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setJoinDebouncedRequest(joinPreviewParams);
    }, 600);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [joinPreviewParams, activeSubtab]);

  useEffect(() => {
    if (activeSubtab !== 'join') return;
    if (!joinDebouncedRequest || !currentWorkspaceId) return;

    let cancelled = false;
    setJoinPreviewLoading(true);
    setJoinPreviewError(null);

    nodesApi.joinPreview(
      currentWorkspaceId,
      {
        left_node_id: joinDebouncedRequest.leftNodeId,
        right_node_id: joinDebouncedRequest.rightNodeId,
        left_on: joinDebouncedRequest.leftOn,
        right_on: joinDebouncedRequest.rightOn,
        how: joinDebouncedRequest.joinType,
      },
      joinDebouncedRequest.page,
      joinDebouncedRequest.pageSize,
    )
      .then((resp) => {
        if (cancelled) return;
        const rows: PreviewRow[] = Array.isArray(resp?.data) ? (resp.data as PreviewRow[]) : [];
        const cols = Array.isArray(resp?.columns) ? resp.columns : [];
        setJoinPreviewData(rows);
        setJoinPreviewColumns(cols);
        if (resp?.pagination) {
          setJoinPreviewPagination(resp.pagination);
          if (resp.pagination.page && resp.pagination.page !== joinPreviewPage) {
            setJoinPreviewPage(resp.pagination.page);
          }
        } else {
          setJoinPreviewPagination(null);
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : 'Failed to load join preview data';
        setJoinPreviewError(message);
        setJoinPreviewData([]);
        setJoinPreviewColumns([]);
        setJoinPreviewPagination(null);
      })
      .finally(() => {
        if (!cancelled) {
          setJoinPreviewLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [joinDebouncedRequest, currentWorkspaceId, activeSubtab, joinPreviewPage]);

  const handleApplyJoin = useCallback(async () => {
    if (!joinConfigReady) {
      setAlertMessage('Please select two different nodes and matching columns to join.');
      setAlertOpen(true);
      return;
    }
    const leftColumns = joinNeedsColumns ? [joinLeftColumn] : [];
    const rightColumns = joinNeedsColumns ? [joinRightColumn] : [];
    const requestedName = joinNewNodeName.trim() || joinNameAutofillRef.current || undefined;
    try {
      setIsJoining(true);
      await joinNodes(joinLeftNodeId, joinRightNodeId, joinType, leftColumns, rightColumns, requestedName);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error applying join';
      setAlertMessage(`Error applying join: ${message}`);
      setAlertOpen(true);
    } finally {
      setIsJoining(false);
    }
  }, [joinConfigReady, joinNeedsColumns, joinLeftColumn, joinRightColumn, joinNewNodeName, joinLeftNodeId, joinRightNodeId, joinType, joinNodes]);

  const uniqueConcatNodeIds = useMemo(() => {
    const seen = new Set<string>();
    return selectedNodeIds.filter((nodeId) => {
      if (!nodeId || seen.has(nodeId)) return false;
      seen.add(nodeId);
      return true;
    });
  }, [selectedNodeIds]);

  const concatNodeIds = useMemo(() => uniqueConcatNodeIds.slice(0, MAX_CONCAT_NODES), [uniqueConcatNodeIds]);
  const concatOriginalCount = uniqueConcatNodeIds.length;

  const concatSelectedNodes = useMemo<WorkspaceNodeLike[]>(() => {
    return concatNodeIds
      .map((nodeId) => workspaceNodeMap.get(nodeId))
      .filter((node): node is WorkspaceNodeLike => Boolean(node));
  }, [concatNodeIds, workspaceNodeMap]);

  const concatNodeSummaries = useMemo<ConcatNodeSummary[]>(() => {
    return concatSelectedNodes.map((node) => {
      const nodeId = getNodeKeyFromNode(node);
      const displayName = deriveNodeLabel(node) || nodeId;
      const data = (node.data ?? {}) as Record<string, unknown>;

      let columns: string[] = [];
      if (Array.isArray(data.columns)) {
        columns = (data.columns as unknown[]).map((entry) => String(entry));
      }

      let rawDtypes: Record<string, string> = {};
      if (data.dtypes && typeof data.dtypes === 'object') {
        rawDtypes = Object.entries(data.dtypes as Record<string, unknown>).reduce<Record<string, string>>((acc, [col, dtype]) => {
          acc[col] = String(dtype);
          return acc;
        }, {});
      } else if (data.schema && typeof data.schema === 'object') {
        rawDtypes = Object.entries(data.schema as Record<string, unknown>).reduce<Record<string, string>>((acc, [col, dtype]) => {
          acc[col] = String(dtype);
          return acc;
        }, {});
      }

      if (!columns.length) {
        columns = Object.keys(rawDtypes);
      }

      const uniqueColumns = Array.from(new Set(columns.map((name) => String(name))));
      const normalizedColumns = [...uniqueColumns].sort((a, b) => a.localeCompare(b));
      const normalizedDtypes = normalizedColumns.reduce<Record<string, string>>((acc, column) => {
        const dtype = rawDtypes[column];
        acc[column] = dtype ? dtype.toString().toLowerCase() : '';
        return acc;
      }, {});

      return {
        nodeId,
        displayName,
        columns: uniqueColumns,
        normalizedColumns,
        dtypes: normalizedDtypes,
        rawDtypes,
        columnCount: uniqueColumns.length,
      };
    });
  }, [concatSelectedNodes, deriveNodeLabel, getNodeKeyFromNode]);

  const concatDefaultPalette = useMemo(
    () => ['#2563eb', '#dc2626', '#16a34a', '#f97316', '#d946ef', '#0ea5e9', '#f59e0b', '#14b8a6'],
    [],
  );

  const concatNodeColors = useMemo(() => {
    const colors: Record<string, string> = {};
    concatNodeIds.forEach((nodeId, index) => {
      colors[nodeId] = concatDefaultPalette[index % concatDefaultPalette.length];
    });
    return colors;
  }, [concatNodeIds, concatDefaultPalette]);

  const concatNodeSelections = useMemo<NodeColumnSelection[]>(() => (
    concatNodeIds.map((nodeId) => ({ nodeId, column: '' }))
  ), [concatNodeIds]);

  const handleConcatColumnChange = useCallback(() => undefined, []);
  const handleConcatColorChange = useCallback(() => undefined, []);

  const concatAnalysis = useMemo<ConcatSchemaAnalysis>(() => {
    const result: ConcatSchemaAnalysis = {
      summaries: concatNodeSummaries,
      ready: false,
      issues: '',
      mismatches: [],
      baseColumns: [],
      baseColumnCount: 0,
    };

    if (concatNodeSummaries.length === 0) {
      result.issues = 'Select nodes in the workspace to enable concatenation.';
      return result;
    }

    if (concatNodeSummaries.length < 2) {
      result.issues = 'Pick at least two nodes to concatenate.';
      return result;
    }

    const base = concatNodeSummaries[0];
    if (!base.normalizedColumns.length) {
      result.issues = `${base.displayName || base.nodeId} has no columns to align.`;
      return result;
    }

    result.baseColumns = base.normalizedColumns;
    result.baseColumnCount = base.normalizedColumns.length;

    const baseColumnSet = new Set(base.normalizedColumns);
    const baseDtypes = base.normalizedColumns.reduce<Record<string, string>>((acc, column) => {
      acc[column] = base.dtypes[column] ?? '';
      return acc;
    }, {});

    concatNodeSummaries.slice(1).forEach((summary) => {
      const summaryColumnSet = new Set(summary.normalizedColumns);
      const missing = Array.from(baseColumnSet).filter((column) => !summaryColumnSet.has(column));
      const extra = Array.from(summaryColumnSet).filter((column) => !baseColumnSet.has(column));
      const typeMismatches = Array.from(baseColumnSet).filter((column) => {
        if (!summaryColumnSet.has(column)) return false;
        const baseType = baseDtypes[column] ?? '';
        const summaryType = summary.dtypes[column] ?? '';
        return baseType && summaryType && baseType !== summaryType;
      });

      const details: string[] = [];
      if (missing.length) {
        details.push(`Missing columns: ${missing.sort().join(', ')}`);
      }
      if (extra.length) {
        details.push(`Extra columns: ${extra.sort().join(', ')}`);
      }
      if (typeMismatches.length) {
        const mismatchText = typeMismatches
          .sort()
          .map((column) => `${column} (${baseDtypes[column] || 'unknown'} vs ${summary.dtypes[column] || 'unknown'})`)
          .join(', ');
        details.push(`Type mismatches: ${mismatchText}`);
      }

      if (details.length) {
        result.mismatches.push({
          nodeId: summary.nodeId,
          nodeName: summary.displayName || summary.nodeId,
          details,
        });
      }
    });

    if (result.mismatches.length === 0) {
      result.ready = true;
      result.issues = `Ready to concatenate ${concatNodeSummaries.length} nodes (${result.baseColumnCount} columns).`;
    } else {
      result.issues = 'Resolve schema mismatches before concatenating.';
    }

    return result;
  }, [concatNodeSummaries]);

  const concatUsedNodeIds = useMemo(() => concatAnalysis.summaries.map((summary) => summary.nodeId), [concatAnalysis.summaries]);
  const concatUsedNodeIdsSignature = useMemo(() => concatUsedNodeIds.join('|'), [concatUsedNodeIds]);

  const concatPreviewReady = activeSubtab === 'concat' && concatAnalysis.ready;

  const concatPreviewColumnsToRender = useMemo(() => {
    if (concatPreviewColumns.length > 0) return concatPreviewColumns;
    if (concatPreviewData.length > 0 && typeof concatPreviewData[0] === 'object' && concatPreviewData[0] !== null) {
      return Object.keys(concatPreviewData[0]);
    }
    return [];
  }, [concatPreviewColumns, concatPreviewData]);

  const concatPreviewTableColSpan = Math.max(concatPreviewColumnsToRender.length, 1);
  const concatPreviewCurrentPage = concatPreviewPagination?.page ?? concatPreviewPage;
  const concatDisplayTotalPages = concatPreviewPagination?.total_pages ?? Math.max(1, concatPreviewCurrentPage);
  const concatStatusMessage = concatAnalysis.issues;

  const autoConcatName = useMemo(() => {
    if (!concatAnalysis.summaries.length) return '';
    const labels = concatAnalysis.summaries.map((summary) => summary.displayName || summary.nodeId).filter(Boolean);
    if (!labels.length) return '';
    if (labels.length <= 3) {
      return `Concat(${labels.join(', ')})`;
    }
    const shortened = `${labels.slice(0, 3).join(', ')}, …`;
    return `Concat(${shortened})`;
  }, [concatAnalysis.summaries]);

  useEffect(() => {
    concatNameAutofillRef.current = autoConcatName || '';
  }, [autoConcatName]);

  useEffect(() => {
    setConcatPreviewPage(1);
  }, [concatUsedNodeIdsSignature]);

  const concatPreviewParams = useMemo<ConcatPreviewRequestSignature | null>(() => {
    if (!concatPreviewReady) return null;
    return {
      nodeIds: concatUsedNodeIds,
      page: concatPreviewPage,
      pageSize: concatPreviewPageSize,
    };
  }, [concatPreviewReady, concatUsedNodeIds, concatPreviewPage, concatPreviewPageSize]);

  useEffect(() => {
    if (activeSubtab !== 'concat') {
      setConcatDebouncedRequest(null);
      setConcatPreviewLoading(false);
      return;
    }
    if (!concatPreviewParams) {
      setConcatDebouncedRequest(null);
      setConcatPreviewData([]);
      setConcatPreviewColumns([]);
      setConcatPreviewPagination(null);
      setConcatPreviewError(null);
      setConcatPreviewLoading(false);
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setConcatDebouncedRequest(concatPreviewParams);
    }, 600);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [concatPreviewParams, activeSubtab]);

  useEffect(() => {
    if (activeSubtab !== 'concat') return;
    if (!concatDebouncedRequest) return;

    let cancelled = false;
    setConcatPreviewLoading(true);
    setConcatPreviewError(null);

    concatPreview(concatDebouncedRequest.nodeIds, concatDebouncedRequest.page, concatDebouncedRequest.pageSize)
      .then((resp) => {
        if (cancelled) return;
        const rows: PreviewRow[] = Array.isArray(resp?.data) ? (resp.data as PreviewRow[]) : [];
        const cols = Array.isArray(resp?.columns) ? resp.columns : [];
        setConcatPreviewData(rows);
        setConcatPreviewColumns(cols);
        if (resp?.pagination) {
          setConcatPreviewPagination(resp.pagination);
          if (resp.pagination.page && resp.pagination.page !== concatPreviewPage) {
            setConcatPreviewPage(resp.pagination.page);
          }
        } else {
          setConcatPreviewPagination(null);
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : 'Failed to load concat preview data';
        setConcatPreviewError(message);
        setConcatPreviewData([]);
        setConcatPreviewColumns([]);
        setConcatPreviewPagination(null);
      })
      .finally(() => {
        if (!cancelled) {
          setConcatPreviewLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [concatDebouncedRequest, concatPreview, activeSubtab, concatPreviewPage]);

  const handleConcatPreviewPrev = useCallback(() => {
    if (concatPreviewPagination?.has_prev && !concatPreviewLoading) {
      setConcatPreviewPage((prev) => Math.max(1, prev - 1));
    }
  }, [concatPreviewPagination, concatPreviewLoading]);

  const handleConcatPreviewNext = useCallback(() => {
    if (concatPreviewPagination?.has_next && !concatPreviewLoading) {
      setConcatPreviewPage((prev) => prev + 1);
    }
  }, [concatPreviewPagination, concatPreviewLoading]);

  const handleConcatPreviewPageSizeChange = useCallback((value: string) => {
    const nextSize = Number(value);
    if (!Number.isNaN(nextSize)) {
      setConcatPreviewPageSize(nextSize);
      setConcatPreviewPage(1);
    }
  }, []);

  const handleApplyConcat = useCallback(async () => {
    if (!concatAnalysis.ready) {
      setAlertMessage(concatStatusMessage || 'Select at least two compatible nodes to concatenate.');
      setAlertOpen(true);
      return;
    }
    const nodeIds = concatAnalysis.summaries.map((summary) => summary.nodeId);
    if (nodeIds.length < 2) {
      setAlertMessage('Pick at least two nodes to concatenate.');
      setAlertOpen(true);
      return;
    }
    const requestedName = concatNewNodeName.trim() || concatNameAutofillRef.current || undefined;
    try {
      setIsConcatenating(true);
      await concatNodes(nodeIds, requestedName);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error applying concat';
      setAlertMessage(`Error applying concat: ${message}`);
      setAlertOpen(true);
    } finally {
      setIsConcatenating(false);
    }
  }, [concatAnalysis, concatStatusMessage, concatNewNodeName, concatNodes]);

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

  const previewReady = activeSubtab === 'filter' && hasSelection && conditions.length > 0 && conditions.every(isConditionComplete);

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
    if (activeSubtab !== 'filter') return;
    setPreviewPage(1);
  }, [previewRequestSignature, activeSubtab]);

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
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Data Preprocessing</h1>
          <p className="text-sm text-muted-foreground">
            Prepare your dataset with filtering and upcoming slice, join, concat, and aggregate tools.
          </p>
        </div>
      </div>
      <Tabs
        value={activeSubtab}
        onValueChange={(value) => setActiveSubtab(value as DataPrepSubtab)}
        className="space-y-6"
      >
        <TabsList aria-label="Data preprocessing sub-views" className="flex flex-wrap gap-2">
          <TabsTrigger value="filter">Filter</TabsTrigger>
          <TabsTrigger value="slice">Slice</TabsTrigger>
          <TabsTrigger value="join">Join</TabsTrigger>
          <TabsTrigger value="concat">Concat</TabsTrigger>
          <TabsTrigger value="aggregate">Aggregate</TabsTrigger>
        </TabsList>

        <TabsContent value="filter" className="space-y-6">
          <Card>
            <CardHeader className="space-y-0 pb-4">
              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                <div>
                  <CardTitle>Filter data</CardTitle>
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
              <NodeSelectionPanel
                selectedNodes={filterSelectedNodesForPanel}
                nodeColumnSelections={filterNodeSelections}
                onColumnChange={handleFilterColumnChange}
                nodeColors={filterNodeColors}
                onColorChange={handleFilterColorChange}
                defaultPalette={filterDefaultPalette}
                maxCompare={1}
                className="rounded-lg border border-border/60 bg-muted/40"
                showColorPicker={false}
                showColumnPicker={false}
                showHeaderLabel
                showShape
                getNodeShapeFn={getNodeShape}
                disabled={filterSelectedNodesForPanel.length === 0}
                originalCount={selectedNodes.length}
              />

              {hasSelection && isSchemaLoading && (
                <div className="rounded-md border border-dashed border-amber-400/60 bg-amber-100/70 p-4 text-sm text-amber-900">
                  Loading column metadata…
                </div>
              )}

              {hasSelection && !isSchemaLoading && !hasSchema && (
                <div className="rounded-md border border-dashed border-amber-400/60 bg-amber-100/70 p-4 text-sm text-amber-900">
                  No schema information is available for this node yet.
                </div>
              )}

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
        </TabsContent>

        <TabsContent value="slice" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Slice datasets</CardTitle>
              <CardDescription>Define row windows or sampling strategies to create focused subsets. This module is under construction.</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                We&apos;re building slicing tools that will let you pick ranges, samples, or stratified splits while keeping lineage intact.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="join" className="space-y-6">
          <Card>
            <CardHeader className="space-y-0 pb-4">
              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                <div>
                  <CardTitle>Join datasets</CardTitle>
                  <CardDescription>
                    Combine two workspace nodes using relational joins and preview the result before committing it to the graph.
                  </CardDescription>
                </div>
                {(isJoining || isLoading.operations) && (
                  <span className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-border bg-muted/60 px-3 py-1 text-xs font-medium text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Joining…
                  </span>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-6 pt-0">
              <p className="text-sm text-muted-foreground">
                Select up to two nodes in the workspace (Shift/⌘-click) to configure a join. Column pickers will appear below for the current selection.
              </p>

              {joinConfigIssues && !joinConfigReady && (
                <div className="rounded-md border border-amber-500/50 bg-amber-100/60 p-3 text-sm text-amber-900">
                  {joinConfigIssues}
                </div>
              )}

              <NodeSelectionPanel
                selectedNodes={joinSelectedNodesForPanel}
                nodeColumnSelections={joinNodeSelections}
                onColumnChange={handleJoinColumnChange}
                nodeColors={joinNodeColors}
                onColorChange={handleJoinColorChange}
                getNodeColumns={(node) => {
                  const key = getNodeKeyFromNode(node);
                  return key ? getNodeColumnsForJoin(key) : [];
                }}
                defaultPalette={joinDefaultPalette}
                maxCompare={2}
                className="rounded-lg border border-border/60 bg-muted/40"
                showColorPicker={false}
                showHeaderLabel
                showShape
                getNodeShapeFn={getNodeShape}
                disabled={joinSelectedNodesForPanel.length < 2}
                originalCount={selectedNodes.length}
                columnLabelFn={(node) => {
                  const nodeId = getNodeKeyFromNode(node);
                  if (nodeId === joinLeftNodeId) return 'Left column:';
                  if (nodeId === joinRightNodeId) return 'Right column:';
                  return 'Join column:';
                }}
              />

              {joinNeedsColumns && joinLeftNodeId && joinRightNodeId && joinLeftNodeId !== joinRightNodeId && (
                <div className="text-xs text-muted-foreground">
                  {joinSharedColumns.length > 0
                    ? `Found ${joinSharedColumns.length} shared column${joinSharedColumns.length === 1 ? '' : 's'} (${joinSharedColumns.slice(0, 4).join(', ')}${joinSharedColumns.length > 4 ? ', …' : ''}).`
                    : 'No matching column names detected. Select compatible columns manually.'}
                </div>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="join-type">Join type</Label>
                  <Select value={joinType} onValueChange={(value) => setJoinType(value as JoinType)}>
                    <SelectTrigger id="join-type">
                      <SelectValue placeholder="Select join type" />
                    </SelectTrigger>
                    <SelectContent>
                      {JOIN_TYPE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.value}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {currentJoinTypeInfo && (
                    <p className="text-xs text-muted-foreground">{currentJoinTypeInfo.description}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="join-new-node-name">New node name</Label>
                  <Input
                    id="join-new-node-name"
                    value={joinNewNodeName}
                    placeholder={autoJoinName || 'Joined dataset'}
                    onChange={(event) => setJoinNewNodeName(event.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">Leave blank to use the suggested name shown in gray.</p>
                </div>
              </div>
            </CardContent>
            <CardFooter className="flex flex-col gap-3 border-t pt-4 md:flex-row md:items-center md:justify-between">
              <div className="text-sm text-muted-foreground">{joinStatusMessage}</div>
              <Button
                type="button"
                onClick={handleApplyJoin}
                disabled={!joinConfigReady || !currentWorkspaceId || isJoining || isLoading.operations}
              >
                {isJoining ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Joining…
                  </>
                ) : (
                  'Add to Workspace'
                )}
              </Button>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader className="space-y-0 pb-4">
              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                <div>
                  <CardTitle>Preview join output</CardTitle>
                  <CardDescription>Inspect a sample of the joined rows before creating the node.</CardDescription>
                </div>
                {joinPreviewLoading && (
                  <span className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-border bg-muted/60 px-3 py-1 text-xs font-medium text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Loading preview…
                  </span>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4 pt-0">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <span>Rows per page</span>
                  <Select
                    value={String(joinPreviewPageSize)}
                    onValueChange={handleJoinPreviewPageSizeChange}
                    disabled={!joinPreviewReady || joinPreviewLoading}
                  >
                    <SelectTrigger className="w-[5.5rem]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PREVIEW_PAGE_SIZE_OPTIONS.map((size) => (
                        <SelectItem key={`join-page-size-${size}`} value={String(size)}>
                          {size}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {joinPreviewPagination?.total_rows !== undefined && joinPreviewPagination?.total_rows !== null && (
                  <div className="text-xs text-muted-foreground">
                    Estimated total rows: {joinPreviewPagination.total_rows.toLocaleString()}
                  </div>
                )}
              </div>

              {!joinConfigReady ? (
                <div className="rounded-md border border-dashed border-muted-foreground/50 bg-muted/30 p-4 text-sm text-muted-foreground">
                  {joinConfigIssues || 'Select two nodes and configure the join to view a preview.'}
                </div>
              ) : joinPreviewError ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
                  {joinPreviewError}
                </div>
              ) : (
                <div className="space-y-3">
                  {joinType === 'cross' && (
                    <div className="rounded-md border border-amber-500/50 bg-amber-100/60 p-3 text-xs text-amber-900">
                      Cross joins can create very large outputs. The preview only displays {joinPreviewPageSize} rows at a time.
                    </div>
                  )}
                  <div className="overflow-x-auto rounded-md border border-border bg-card">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {joinPreviewColumnsToRender.length > 0 ? (
                            joinPreviewColumnsToRender.map((column) => (
                              <TableHead
                                key={`join-preview-header-${column}`}
                                className="min-w-[8rem] px-2 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                              >
                                {column}
                              </TableHead>
                            ))
                          ) : (
                            <TableHead className="px-2 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              Preview
                            </TableHead>
                          )}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {joinPreviewLoading && joinPreviewData.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={joinPreviewTableColSpan} className="py-8 text-center text-sm text-muted-foreground">
                              Loading preview rows…
                            </TableCell>
                          </TableRow>
                        ) : joinPreviewData.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={joinPreviewTableColSpan} className="py-8 text-center text-sm text-muted-foreground">
                              No rows returned for this configuration.
                            </TableCell>
                          </TableRow>
                        ) : (
                          joinPreviewData.map((row, rowIndex) => (
                            <TableRow key={`join-preview-row-${rowIndex}`}>
                              {joinPreviewColumnsToRender.map((column) => (
                                <TableCell
                                  key={`join-preview-cell-${rowIndex}-${column}`}
                                  className="whitespace-pre-wrap px-2 py-1 text-sm font-mono text-foreground"
                                >
                                  {formatPreviewValue((row as PreviewRow)[column])}
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
            {joinPreviewReady && (
              <CardFooter className="flex items-center justify-between border-t pt-4">
                <div className="text-sm text-muted-foreground">
                  Page {joinPreviewCurrentPage} of {joinDisplayTotalPages}
                </div>
                <div className="flex items-center gap-3">
                  <Button
                    type="button"
                    onClick={handleJoinPreviewPrev}
                    disabled={!joinPreviewPagination?.has_prev || joinPreviewLoading}
                    size="sm"
                    variant="outline"
                  >
                    Previous
                  </Button>
                  <Button
                    type="button"
                    onClick={handleJoinPreviewNext}
                    disabled={!joinPreviewPagination?.has_next || joinPreviewLoading}
                    size="sm"
                    variant="outline"
                  >
                    Next
                  </Button>
                </div>
              </CardFooter>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="concat" className="space-y-6">
          <Card>
            <CardHeader className="space-y-0 pb-4">
              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                <div>
                  <CardTitle>Concatenate datasets</CardTitle>
                  <CardDescription>Stack compatible nodes vertically into a single dataset.</CardDescription>
                </div>
                {(isConcatenating || isLoading.operations) && (
                  <span className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-border bg-muted/60 px-3 py-1 text-xs font-medium text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Concatenating…
                  </span>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-6 pt-0">
              <p className="text-sm text-muted-foreground">
                Multi-select nodes in the workspace (Shift/⌘-click) to stack them vertically. We′ll align schemas and preserve column order.
              </p>

              <NodeSelectionPanel
                selectedNodes={concatSelectedNodes}
                nodeColumnSelections={concatNodeSelections}
                onColumnChange={handleConcatColumnChange}
                nodeColors={concatNodeColors}
                onColorChange={handleConcatColorChange}
                defaultPalette={concatDefaultPalette}
                maxCompare={MAX_CONCAT_NODES}
                className="rounded-lg border border-border/60 bg-muted/40"
                showColorPicker={false}
                showColumnPicker={false}
                showHeaderLabel
                showShape
                getNodeShapeFn={getNodeShape}
                disabled={concatSelectedNodes.length < 2}
                originalCount={concatOriginalCount}
              />

              {concatOriginalCount > MAX_CONCAT_NODES && (
                <div className="rounded-md border border-amber-500/50 bg-amber-100/60 p-3 text-sm text-amber-900">
                  Using the first {MAX_CONCAT_NODES} of {concatOriginalCount} selected nodes. Deselect extras to include them.
                </div>
              )}

              {concatAnalysis.mismatches.length > 0 && (
                <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                  <div className="font-semibold">Schema mismatches detected:</div>
                  <ul className="space-y-2">
                    {concatAnalysis.mismatches.map((mismatch) => (
                      <li key={`concat-mismatch-${mismatch.nodeId}`} className="space-y-1">
                        <div className="font-medium">{mismatch.nodeName}</div>
                        {mismatch.details.map((detail, idx) => (
                          <div key={`concat-mismatch-${mismatch.nodeId}-${idx}`} className="text-destructive">
                            {detail}
                          </div>
                        ))}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="concat-new-node-name">New node name</Label>
                  <Input
                    id="concat-new-node-name"
                    value={concatNewNodeName}
                    placeholder={autoConcatName || 'Concatenated dataset'}
                    onChange={(event) => setConcatNewNodeName(event.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">Leave blank to use the suggested name shown in gray.</p>
                </div>
                <div className="space-y-2">
                  <Label>Schema status</Label>
                  <div className="rounded-md border border-muted-foreground/40 bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                    {concatStatusMessage}
                  </div>
                </div>
              </div>
            </CardContent>
            <CardFooter className="flex flex-col gap-3 border-t pt-4 md:flex-row md:items-center md:justify-between">
              <div className="text-sm text-muted-foreground">{concatStatusMessage}</div>
              <Button
                type="button"
                onClick={handleApplyConcat}
                disabled={!concatAnalysis.ready || !currentWorkspaceId || isConcatenating || isLoading.operations}
              >
                {isConcatenating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Concatenating…
                  </>
                ) : (
                  'Add to Workspace'
                )}
              </Button>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader className="space-y-0 pb-4">
              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                <div>
                  <CardTitle>Preview concat output</CardTitle>
                  <CardDescription>Inspect a sample of the stacked rows before creating the node.</CardDescription>
                </div>
                {concatPreviewLoading && (
                  <span className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-border bg-muted/60 px-3 py-1 text-xs font-medium text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Loading preview…
                  </span>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4 pt-0">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <span>Rows per page</span>
                  <Select
                    value={String(concatPreviewPageSize)}
                    onValueChange={handleConcatPreviewPageSizeChange}
                    disabled={!concatPreviewReady || concatPreviewLoading}
                  >
                    <SelectTrigger className="w-[5.5rem]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PREVIEW_PAGE_SIZE_OPTIONS.map((size) => (
                        <SelectItem key={`concat-page-size-${size}`} value={String(size)}>
                          {size}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {concatPreviewPagination?.total_rows !== undefined && concatPreviewPagination?.total_rows !== null && (
                  <div className="text-xs text-muted-foreground">
                    Estimated total rows: {concatPreviewPagination.total_rows.toLocaleString()}
                  </div>
                )}
              </div>

              {!concatPreviewReady ? (
                <div className="rounded-md border border-dashed border-muted-foreground/50 bg-muted/30 p-4 text-sm text-muted-foreground">
                  {concatAnalysis.summaries.length < 2
                    ? 'Select at least two nodes to generate a concat preview.'
                    : concatStatusMessage}
                </div>
              ) : concatPreviewError ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
                  {concatPreviewError}
                </div>
              ) : (
                <div className="overflow-x-auto rounded-md border border-border bg-card">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {concatPreviewColumnsToRender.length > 0 ? (
                          concatPreviewColumnsToRender.map((column) => (
                            <TableHead
                              key={`concat-preview-header-${column}`}
                              className="min-w-[8rem] px-2 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                            >
                              {column}
                            </TableHead>
                          ))
                        ) : (
                          <TableHead className="px-2 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Preview
                          </TableHead>
                        )}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {concatPreviewLoading && concatPreviewData.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={concatPreviewTableColSpan} className="py-8 text-center text-sm text-muted-foreground">
                            Loading preview rows…
                          </TableCell>
                        </TableRow>
                      ) : concatPreviewData.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={concatPreviewTableColSpan} className="py-8 text-center text-sm text-muted-foreground">
                            No rows returned for this configuration.
                          </TableCell>
                        </TableRow>
                      ) : (
                        concatPreviewData.map((row, rowIndex) => (
                          <TableRow key={`concat-preview-row-${rowIndex}`}>
                            {concatPreviewColumnsToRender.map((column) => (
                              <TableCell
                                key={`concat-preview-cell-${rowIndex}-${column}`}
                                className="whitespace-pre-wrap px-2 py-1 text-sm font-mono text-foreground"
                              >
                                {formatPreviewValue((row as PreviewRow)[column])}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
            {concatPreviewReady && (
              <CardFooter className="flex items-center justify-between border-t pt-4">
                <div className="text-sm text-muted-foreground">
                  Page {concatPreviewCurrentPage} of {concatDisplayTotalPages}
                </div>
                <div className="flex items-center gap-3">
                  <Button
                    type="button"
                    onClick={handleConcatPreviewPrev}
                    disabled={!concatPreviewPagination?.has_prev || concatPreviewLoading}
                    size="sm"
                    variant="outline"
                  >
                    Previous
                  </Button>
                  <Button
                    type="button"
                    onClick={handleConcatPreviewNext}
                    disabled={!concatPreviewPagination?.has_next || concatPreviewLoading}
                    size="sm"
                    variant="outline"
                  >
                    Next
                  </Button>
                </div>
              </CardFooter>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="aggregate" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Aggregate datasets</CardTitle>
              <CardDescription>Group and summarize data across columns. Aggregation tooling will land here shortly.</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Aggregation presets will let you pick metrics, group keys, and collect results into new workspace nodes.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

      </Tabs>

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

export default DataPreprocessingTab;
