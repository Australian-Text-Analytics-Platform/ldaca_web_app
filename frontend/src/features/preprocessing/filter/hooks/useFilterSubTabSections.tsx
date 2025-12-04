import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { nodesApi } from '../../../../api/nodes';
import { Button } from '../../../../components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../../components/ui/select';
import { Checkbox } from '../../../../components/ui/checkbox';
import type { NodeColumnSelection, WorkspaceNodeLike } from '../../../../components/NodeSelectionPanel';
import { DateTimePickerField } from '../../utils/dateTimeUtils';
import { normalizeTypeName, getOperatorsForType, formatPreviewValue } from '../../utils/typeUtils';
import { ISO_PLACEHOLDER } from '../../utils/dateTimeHelpers';
import { usePreprocessingPreview } from '../../hooks/usePreprocessingPreview';
import { buildFilterRequestPayload, isConditionComplete } from '../utils/serializers';
import type {
  ConditionRange,
  ConditionValue,
  FilterCondition,
  FilterConditionWithId,
  FilterRequest,
  ConditionColumnOption,
  PreviewPagination,
  PreviewRow,
} from '../../types';

export interface FilterSubTabProps {
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
  filterPreview: (
    nodeId: string,
    request: FilterRequest,
    page: number,
    pageSize: number,
  ) => Promise<{
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

interface FilterSelectionPanelConfig {
  selectedNodes: WorkspaceNodeLike[];
  nodeColumnSelections: NodeColumnSelection[];
  nodeColors: Record<string, string>;
  defaultPalette: string[];
  onColumnChange: () => void;
  onColorChange: () => void;
  disabled: boolean;
}

interface FilterConditionBuilderConfig {
  conditions: FilterConditionWithId[];
  availableColumns: ConditionColumnOption[];
  logic: 'and' | 'or';
  setLogic: (logic: 'and' | 'or') => void;
  onAddCondition: () => void;
  onRemoveCondition: (id: string) => void;
  onConditionChange: <Key extends keyof FilterConditionWithId>(id: string, field: Key, value: FilterConditionWithId[Key]) => void;
  renderValueInput: (condition: FilterConditionWithId, disabled: boolean) => React.ReactNode;
  renderConditionMetadata: (condition: FilterConditionWithId, rowDisabled: boolean) => React.ReactNode;
  shouldHideOperatorSelect: (condition: FilterConditionWithId) => boolean;
  getOperatorOptions: (condition: FilterConditionWithId) => ReturnType<typeof getOperatorsForType>;
}

interface FilterPreviewConfig {
  columns: string[];
  data: PreviewRow[];
  pagination: PreviewPagination | null;
  loading: boolean;
  error: string | null;
  ready: boolean;
  readyMessage: string;
  page: number;
  pageSize: number;
  onPreviousPage: () => void;
  onNextPage: () => void;
  onPageSizeChange: (size: number) => void;
}

export interface UseFilterSubTabSectionsResult {
  selectionPanel: FilterSelectionPanelConfig;
  schemaState: {
    hasSelection: boolean;
    hasSchema: boolean;
    isSchemaLoading: boolean;
    isConfigDisabled: boolean;
  };
  conditionBuilder: FilterConditionBuilderConfig;
  newNodeInput: {
    value: string;
    setValue: (value: string) => void;
    disabled: boolean;
  };
  summaryText: string;
  isFiltering: boolean;
  applyFilter: () => Promise<void>;
  applyButtonDisabled: boolean;
  preview: FilterPreviewConfig;
  getNodeShape: FilterSubTabProps['getNodeShape'];
  selectedNodesOriginalCount: number;
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

export const useFilterSubTabSections = (props: FilterSubTabProps): UseFilterSubTabSectionsResult => {
  const {
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
  } = props;
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
  const [categoricalOptions, setCategoricalOptions] = useState<Record<string, {
    options: CategoricalOptionEntry[];
    hasNull: boolean;
    loading: boolean;
    error: string | null;
  }>>({});

  const availableColumns = useMemo(() => {
    const columns: ConditionColumnOption[] = [];
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

  const filterPreviewRequest = useMemo(() => {
    if (!previewReady || !selectedNodeId || !previewRequest) {
      return null;
    }
    return {
      nodeId: selectedNodeId,
      payload: previewRequest,
    };
  }, [previewReady, selectedNodeId, previewRequest]);

  const filterPreviewFetcher = useCallback(async ({
    request,
    page,
    pageSize,
    signal: _signal,
  }: {
    request: { nodeId: string; payload: FilterRequest };
    page: number;
    pageSize: number;
    signal: AbortSignal;
  }) => {
    const response = await filterPreview(request.nodeId, request.payload, page, pageSize);
    return {
      data: Array.isArray(response?.data) ? (response.data as PreviewRow[]) : [],
      columns: Array.isArray(response?.columns) ? response.columns : [],
      pagination: response?.pagination ?? null,
    };
  }, [filterPreview]);

  const {
    data: previewData,
    columns: previewColumns,
    pagination: previewPagination,
    loading: previewLoading,
    error: previewError,
    page: previewPage,
    pageSize: previewPageSize,
    setPage: setPreviewPage,
    setPageSize: setPreviewPageSize,
  } = usePreprocessingPreview({
    request: filterPreviewRequest,
    signature: previewRequestSignature,
    fetcher: filterPreviewFetcher,
  });

  const previewColumnsToRender = useMemo(() => {
    if (previewColumns.length > 0) return previewColumns;
    if (previewData.length > 0 && typeof previewData[0] === 'object' && previewData[0] !== null) {
      return Object.keys(previewData[0]);
    }
    return [];
  }, [previewColumns, previewData]);

  const currentPreviewPage = previewPagination?.page ?? previewPage;
  const previewHasPrev = Boolean(previewPagination?.has_prev);
  const previewHasNext = Boolean(previewPagination?.has_next);

  const handlePreviewPrev = useCallback(() => {
    if (previewHasPrev && !previewLoading) {
      setPreviewPage(Math.max(1, currentPreviewPage - 1));
    }
  }, [previewHasPrev, previewLoading, currentPreviewPage, setPreviewPage]);

  const handlePreviewNext = useCallback(() => {
    if (previewHasNext && !previewLoading) {
      setPreviewPage(currentPreviewPage + 1);
    }
  }, [previewHasNext, previewLoading, currentPreviewPage, setPreviewPage]);

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

  const renderConditionMetadata = useCallback(
    (condition: FilterConditionWithId, rowDisabled: boolean) => (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <label className="flex items-center gap-1.5">
          <Checkbox
            id={`negate-${condition.id}`}
            checked={Boolean(condition.negate)}
            onCheckedChange={(checked) => handleConditionChange(condition.id, 'negate', checked === true)}
            disabled={rowDisabled}
          />
          <span>negate</span>
        </label>

        {condition.dataType === 'string' && condition.operator === 'contains' && (
          <label className="flex items-center gap-1.5">
            <Checkbox
              id={`regex-${condition.id}`}
              checked={Boolean(condition.regex ?? true)}
              onCheckedChange={(checked) => handleConditionChange(condition.id, 'regex', checked === true)}
              disabled={rowDisabled}
            />
            <span>regex</span>
          </label>
        )}
      </div>
    ),
    [handleConditionChange]
  );

  const shouldHideOperatorSelect = (condition: FilterConditionWithId) => condition.dataType === 'categorical';

  const getConditionOperatorOptions = (condition: FilterConditionWithId) => (
    getOperatorsForType(condition.dataType || 'string')
  );

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

  const renderConditionValueInput = (condition: FilterConditionWithId, disabled: boolean) => {
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
  const previewReadyMessage = !hasSelection
    ? 'Select a node to preview filtered results.'
    : 'Configure at least one complete condition to see a live preview of the filtered rows.';

  const summaryText = conditions.length === 0
    ? 'Define at least one condition to enable preview and filtering.'
    : `${conditions.length} condition${conditions.length === 1 ? '' : 's'} configured (${logic.toUpperCase()} logic).`;

  const applyButtonDisabled = isConfigDisabled || isFiltering || isLoading.operations;

  return {
    selectionPanel: {
      selectedNodes: filterSelectedNodesForPanel,
      nodeColumnSelections: filterNodeSelections,
      nodeColors: filterNodeColors,
      defaultPalette: filterDefaultPalette,
      onColumnChange: handleFilterColumnChange,
      onColorChange: handleFilterColorChange,
      disabled: filterSelectedNodesForPanel.length === 0,
    },
    schemaState: {
      hasSelection,
      hasSchema,
      isSchemaLoading,
      isConfigDisabled,
    },
    conditionBuilder: {
      conditions,
      availableColumns,
      logic,
      setLogic,
      onAddCondition: handleAddCondition,
      onRemoveCondition: handleRemoveCondition,
      onConditionChange: handleConditionChange,
      renderValueInput: renderConditionValueInput,
      renderConditionMetadata,
      shouldHideOperatorSelect,
      getOperatorOptions: getConditionOperatorOptions,
    },
    newNodeInput: {
      value: newNodeName,
      setValue: setNewNodeName,
      disabled: !hasSelection,
    },
    summaryText,
    isFiltering,
    applyFilter: handleApplyFilter,
    applyButtonDisabled,
    preview: {
      columns: previewColumnsToRender,
      data: previewData,
      pagination: previewPagination,
      loading: previewLoading,
      error: previewError,
      ready: previewReady,
      readyMessage: previewReadyMessage,
      page: currentPreviewPage,
      pageSize: previewPageSize,
      onPreviousPage: handlePreviewPrev,
      onNextPage: handlePreviewNext,
      onPageSizeChange: setPreviewPageSize,
    },
    getNodeShape,
    selectedNodesOriginalCount: selectedNodes.length,
  };
};
