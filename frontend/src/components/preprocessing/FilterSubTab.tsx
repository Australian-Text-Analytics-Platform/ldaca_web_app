import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { nodesApi } from '../../api/nodes';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Checkbox } from '../ui/checkbox';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../ui/card';
import NodeSelectionPanel, { NodeColumnSelection, WorkspaceNodeLike } from '../NodeSelectionPanel';
import { PreviewTable } from './PreviewTable';
import { DateTimePickerField } from './utils/dateTimeUtils';
import { normalizeTypeName, getOperatorsForType, formatPreviewValue } from './utils/typeUtils';
import { ISO_PLACEHOLDER } from './utils/dateTimeHelpers';
import type {
  ConditionRange,
  ConditionValue,
  FilterCondition,
  FilterConditionWithId,
  FilterRequest,
  PreviewPagination,
  PreviewRow,
} from './types';

interface FilterSubTabProps {
  selectedNodeId: string | null;
  selectedNode: WorkspaceNodeLike | null;
  selectedNodes: WorkspaceNodeLike[];
  nodeData: {
    columns?: string[];
    dtypes?: Record<string, string>;
  } | null;
  currentWorkspaceId: string | null;
  workspaceNodes: WorkspaceNodeLike[];
  getNodeShape: (nodeId: string) => Promise<{ shape: [number, number]; is_lazy: boolean; calculated: boolean } | null>;
  filterNode: (nodeId: string, request: FilterRequest) => Promise<void>;
  filterPreview: (nodeId: string, request: FilterRequest, page: number, pageSize: number) => Promise<{
    data: PreviewRow[];
    columns: string[];
    pagination: PreviewPagination | null;
  }>;
  isLoading: {
    nodeData: boolean;
    graph: boolean;
    operations: boolean;
  };
  onAlert: (message: string) => void;
}

type CategoricalPrimitive = string | number | boolean | null;

interface CategoricalOptionEntry {
  key: string;
  value: CategoricalPrimitive;
  label: string;
  isNull: boolean;
}

const NULL_OPTION_KEY = '__LDACA_NULL__';

const toCategoricalPrimitive = (value: unknown): CategoricalPrimitive => {
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
};

const getCategoricalOptionKey = (value: CategoricalPrimitive): string => {
  if (value === null) return NULL_OPTION_KEY;
  return `${typeof value}::${String(value)}`;
};

const getDefaultOperatorForType = (dataType: string): FilterCondition['operator'] => {
  const operators = getOperatorsForType(dataType);
  return (operators[0]?.value as FilterCondition['operator']) ?? 'eq';
};

const hasNonEmptyValue = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number' || typeof value === 'boolean') return true;
  if (value instanceof Date) return true;
  if (Array.isArray(value)) {
    if (value.length === 0) return false;
    return value.some((entry) => (entry === null ? true : hasNonEmptyValue(entry)));
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
    } else if (Array.isArray(condition.value)) {
      value = condition.value.map((entry) => (entry instanceof Date ? entry.toISOString() : entry));
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

export const FilterSubTab: React.FC<FilterSubTabProps> = ({
  selectedNodeId,
  selectedNode,
  selectedNodes,
  nodeData,
  currentWorkspaceId,
  workspaceNodes,
  getNodeShape,
  filterNode,
  filterPreview,
  isLoading,
  onAlert,
}) => {
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
  const [categoricalOptions, setCategoricalOptions] = useState<Record<string, {
    options: CategoricalOptionEntry[];
    hasNull: boolean;
    loading: boolean;
    error: string | null;
  }>>({});

  const availableColumns = useMemo(() => {
    const columns: Array<{ name: string; dataType: string }> = [];
    const dtypes =
      nodeData?.dtypes && typeof nodeData.dtypes === 'object'
        ? (nodeData.dtypes as Record<string, string | undefined>)
        : undefined;

    if (Array.isArray(nodeData?.columns) && dtypes) {
      nodeData.columns.forEach((colName: string) => {
        const rawDataType = dtypes[colName] ?? 'unknown';
        const normalizedDataType = normalizeTypeName(rawDataType);
        columns.push({ name: colName, dataType: normalizedDataType });
      });
    } else if (dtypes) {
      Object.entries(dtypes).forEach(([colName, rawType]) => {
        const normalizedDataType = normalizeTypeName(rawType ?? 'unknown');
        columns.push({ name: colName, dataType: normalizedDataType });
      });
    } else if (selectedNode?.data?.schema) {
      Object.keys(selectedNode.data.schema).forEach((colName) => {
        columns.push({ name: colName, dataType: 'string' });
      });
    }

    return columns;
  }, [nodeData?.columns, nodeData?.dtypes, selectedNode?.data?.schema]);

  const hasSelection = Boolean(selectedNodeId);
  const hasSchema = availableColumns.length > 0;
  const isSchemaLoading = hasSelection && !hasSchema && (isLoading.nodeData || isLoading.graph);
  const isConfigDisabled = !hasSelection || !hasSchema;

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

  const getCategoricalKey = useCallback(
    (column: string) => `${currentWorkspaceId ?? 'none'}::${selectedNodeId ?? 'none'}::${column}`,
    [currentWorkspaceId, selectedNodeId]
  );

  const ensureCategoricalOptions = useCallback(
    async (column: string) => {
      if (!currentWorkspaceId || !selectedNodeId || !column) {
        return;
      }

      const key = getCategoricalKey(column);
      setCategoricalOptions((prev) => {
        const existing = prev[key];
        if (existing?.loading) {
          return prev;
        }
        return {
          ...prev,
          [key]: {
            options: existing?.options ?? [],
            hasNull: existing?.hasNull ?? false,
            loading: true,
            error: null,
          },
        };
      });

      try {
        const response = await nodesApi.uniqueValues(currentWorkspaceId, selectedNodeId, column);
        const rawValues: unknown[] = Array.isArray(response?.unique_values) ? response.unique_values : [];
        const hasNullFromResponse = Boolean(response?.has_null);
        const uniqueEntries = new Map<string, CategoricalOptionEntry>();

        rawValues.forEach((value) => {
          const primitive = toCategoricalPrimitive(value);
          if (primitive === null) {
            return;
          }
          const optionKey = getCategoricalOptionKey(primitive);
          if (!uniqueEntries.has(optionKey)) {
            uniqueEntries.set(optionKey, {
              key: optionKey,
              value: primitive,
              label: formatPreviewValue(primitive),
              isNull: false,
            });
          }
        });

        const optionList: CategoricalOptionEntry[] = [];
        if (hasNullFromResponse) {
          optionList.push({
            key: NULL_OPTION_KEY,
            value: null,
            label: 'Null (no value)',
            isNull: true,
          });
        }
        optionList.push(...uniqueEntries.values());

        setCategoricalOptions((prev) => ({
          ...prev,
          [key]: {
            options: optionList,
            hasNull: hasNullFromResponse,
            loading: false,
            error: null,
          },
        }));
      } catch (error) {
        setCategoricalOptions((prev) => ({
          ...prev,
          [key]: {
            options: [],
            hasNull: false,
            loading: false,
            error: error instanceof Error ? error.message : 'Failed to load categories',
          },
        }));
      }
    },
    [currentWorkspaceId, selectedNodeId, getCategoricalKey]
  );

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

  const handleFilterColorChange = useCallback(() => undefined, []);
  const handleFilterColumnChange = useCallback(() => undefined, []);

  useEffect(() => {
    setCategoricalOptions({});
  }, [currentWorkspaceId, selectedNodeId]);

  useEffect(() => {
    if (!currentWorkspaceId || !selectedNodeId) {
      return;
    }

    conditions.forEach((condition) => {
      if (condition.dataType === 'categorical' && condition.column) {
        const key = getCategoricalKey(condition.column);
        if (!categoricalOptions[key]) {
          void ensureCategoricalOptions(condition.column);
        }
      }
    });
  }, [conditions, currentWorkspaceId, selectedNodeId, categoricalOptions, getCategoricalKey, ensureCategoricalOptions]);

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

  const currentPreviewPage = previewPagination?.page ?? previewPage;

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
    const defaultOperator = firstColumn ? getDefaultOperatorForType(firstColumn.dataType) : 'eq';
    const defaultValue: ConditionValue = defaultOperator === 'in' ? [] : '';
    const newCondition: FilterConditionWithId = {
      id: Date.now().toString(),
      column: firstColumn ? firstColumn.name : '',
      operator: defaultOperator,
      value: defaultValue,
      dataType: firstColumn ? firstColumn.dataType : 'string',
      negate: false,
      regex: defaultOperator === 'contains',
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
    let nextCategoricalColumnToLoad: string | null = null;

    setConditions(conditions.map((c) => {
      if (c.id !== id) return c;
      
      const updated = { ...c, [field]: value };
      
      // If column changed, update dataType and reset operator
      if (field === 'column') {
        const columnInfo = availableColumns.find(col => col.name === value);
        if (columnInfo) {
          updated.dataType = columnInfo.dataType;
          const nextOperator = getDefaultOperatorForType(columnInfo.dataType);
          updated.operator = nextOperator;
          updated.value = nextOperator === 'in' ? [] : '';
          updated.regex = nextOperator === 'contains';

          if (columnInfo.dataType === 'categorical') {
            nextCategoricalColumnToLoad = columnInfo.name;
          }
          
          // Pre-fill datetime values if datetime column
          if (
            columnInfo.dataType === 'datetime' &&
            selectedNodeId &&
            currentWorkspaceId &&
            nextOperator !== 'is_null'
          ) {
            prefillDatetimeValue(id, columnInfo.name, nextOperator);
          }
        }
      }
      
      if (field === 'operator') {
        if (value === 'in') {
          updated.value = Array.isArray(updated.value) ? updated.value : [];
          if (updated.dataType === 'categorical' && updated.column) {
            nextCategoricalColumnToLoad = updated.column;
          }
        } else if (updated.dataType === 'categorical' && Array.isArray(updated.value)) {
          updated.value = updated.value[0] ?? '';
        }

        if (
          updated.dataType === 'datetime' &&
          updated.column &&
          selectedNodeId &&
          currentWorkspaceId
        ) {
          updated.value = '';
          if (value !== 'is_null') {
            prefillDatetimeValue(id, updated.column, value as FilterCondition['operator']);
          }
        }
      }
      
      return updated;
    }));

    if (nextCategoricalColumnToLoad) {
      void ensureCategoricalOptions(nextCategoricalColumnToLoad);
    }
  };

  // Pre-fill datetime values based on operator and column statistics
  const prefillDatetimeValue = async (
    conditionId: string,
    column: string,
    operator: FilterCondition['operator']
  ) => {
    if (!selectedNodeId || !currentWorkspaceId) return;
    
    try {
      const describeData = await nodesApi.describeColumn(currentWorkspaceId, selectedNodeId, column);
      
      setConditions(prev => prev.map(c => {
        if (c.id !== conditionId) return c;
        
        let newValue: ConditionValue = '';
        
        switch (operator) {
          case 'eq':
            newValue = describeData.median || describeData.min || '';
            break;
          case 'gte':
            newValue = describeData.min || '';
            break;
          case 'lte':
            newValue = describeData.max || '';
            break;
          case 'between':
            newValue = {
              start: (describeData.min as ConditionRange['start']) || '',
              end: (describeData.max as ConditionRange['end']) || ''
            };
            break;
          default:
            newValue = '';
        }
        
        return { ...c, value: newValue };
      }));
    } catch (error) {
      console.error('Failed to fetch describe data for pre-filling:', error);
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

    if (dataType === 'categorical') {
      const column = condition.column;
      const key = column ? getCategoricalKey(column) : null;
      const optionState = key ? categoricalOptions[key] : undefined;
      const optionEntries = optionState?.options ?? [];
      const selectedValues = Array.isArray(condition.value)
        ? (condition.value as Array<unknown>).map(toCategoricalPrimitive)
        : [];
      const selectedKeys = new Set(selectedValues.map((entry) => getCategoricalOptionKey(entry)));
      const isLoadingOptions = optionState?.loading ?? false;
      const optionError = optionState?.error;

      const updateSelections = (nextSelections: CategoricalPrimitive[]) => {
        handleConditionChange(condition.id, 'value', nextSelections);
      };

      const toggleValue = (entry: CategoricalOptionEntry, nextChecked: boolean) => {
        if (disabled) return;
        if (nextChecked) {
          if (selectedKeys.has(entry.key)) return;
          updateSelections([...selectedValues, entry.value]);
        } else {
          updateSelections(
            selectedValues.filter(
              (current) => getCategoricalOptionKey(current) !== entry.key,
            ),
          );
        }
      };

      const handleSelectAll = () => {
        if (disabled) return;
        updateSelections(optionEntries.map((entry) => entry.value));
      };

      const handleClearAll = () => {
        if (disabled) return;
        updateSelections([]);
      };

      return (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={disabled || isLoadingOptions || optionEntries.length === 0}
              onClick={handleSelectAll}
            >
              Select all
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled || (selectedKeys.size === 0 && !isLoadingOptions)}
              onClick={handleClearAll}
            >
              Clear
            </Button>
            {optionError && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => column && ensureCategoricalOptions(column)}
                disabled={disabled}
              >
                Retry
              </Button>
            )}
          </div>

          {isLoadingOptions ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Loading categories…</span>
            </div>
          ) : optionError ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              Failed to load categories: {optionError}
            </div>
          ) : (
            <div className="max-h-48 overflow-y-auto rounded-md border border-border/60 bg-background px-3 py-2">
              {optionEntries.length === 0 ? (
                <div className="text-xs text-muted-foreground">No categories available.</div>
              ) : (
                optionEntries.map((option) => {
                  const checked = selectedKeys.has(option.key);
                  return (
                    <label
                      key={`${condition.id}-${option.key}`}
                      className={`flex items-center gap-2 py-1 text-sm ${
                        option.isNull ? 'text-amber-700' : 'text-foreground'
                      }`}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(next) => toggleValue(option, next === true)}
                        disabled={disabled}
                        id={`${condition.id}-${option.key}`}
                      />
                      <span
                        className={`flex-1 truncate ${option.isNull ? 'font-medium' : ''}`}
                        title={option.isNull ? 'Null (no value)' : option.label}
                      >
                        {option.isNull ? 'Null (no value)' : option.label}
                      </span>
                    </label>
                  );
                })
              )}
            </div>
          )}
        </div>
      );
    }

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
              <DateTimePickerField
                value={startStr}
                onChange={(v) =>
                  handleConditionChange(condition.id, 'value', {
                    start: v,
                    end: rangeValue.end ?? null,
                  })
                }
                placeholder={ISO_PLACEHOLDER}
              />
            </div>
            <div className="flex-none">
              <DateTimePickerField
                value={endStr}
                onChange={(v) =>
                  handleConditionChange(condition.id, 'value', {
                    start: rangeValue.start ?? null,
                    end: v,
                  })
                }
                placeholder={ISO_PLACEHOLDER}
              />
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
      return (
        <DateTimePickerField
          value={singleVal}
          onChange={(v) => handleConditionChange(condition.id, 'value', v)}
          placeholder={ISO_PLACEHOLDER}
        />
      );
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
      onAlert('Please select a node first');
      return;
    }

    if (conditions.length === 0 || conditions.some((condition) => !isConditionComplete(condition))) {
      onAlert('Please fill in all filter conditions');
      return;
    }

    const request: FilterRequest = buildFilterRequestPayload(conditions, logic, newNodeName);

    try {
      setIsFiltering(true);
      await filterNode(selectedNodeId, request);
    } catch (error) {
      console.error('Filter error:', error);
      onAlert(`Error applying filter: ${error instanceof Error ? error.message : 'Unknown error'}`);
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

                      {condition.dataType !== 'categorical' && (
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
                      )}

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

      <PreviewTable
        title="Preview filtered rows"
        description="Review rows that match the current filter configuration."
        columns={previewColumnsToRender}
        data={previewData}
        pagination={previewPagination}
        loading={previewLoading}
        error={previewError}
        ready={previewReady}
        readyMessage={!hasSelection
          ? 'Select a node to preview filtered results.'
          : 'Configure at least one complete condition to see a live preview of the filtered rows.'
        }
        page={currentPreviewPage}
        pageSize={previewPageSize}
        onPageSizeChange={(size) => {
          setPreviewPageSize(size);
          setPreviewPage(1);
        }}
        onPreviousPage={handlePreviewPrev}
        onNextPage={handlePreviewNext}
      />
    </div>
  );
};
