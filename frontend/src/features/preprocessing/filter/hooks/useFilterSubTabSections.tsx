import React, { useCallback, useState, useEffect, useRef } from 'react';
import { nodesApi } from '../../../../api/nodes';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../../components/ui/select';
import { Checkbox } from '../../../../components/ui/checkbox';
import type { NodeColumnSelection, WorkspaceNodeLike } from '../../../../components/NodeSelectionPanel';
import { DateTimePickerField } from '../../utils/dateTimeUtils';
import { normalizeTypeName, getOperatorsForType, formatPreviewValue } from '../../utils/typeUtils';
import { ISO_PLACEHOLDER } from '../../utils/dateTimeHelpers';
import { buildFilterAutoNodeName } from '../../utils/autoNodeNames';
import { usePreprocessingPreview } from '../../hooks/usePreprocessingPreview';
import { buildFilterRequestPayload, isConditionComplete } from '../utils/serializers';
import { FilterValueChecklist } from '../components/FilterValueChecklist';
import type { FilterChecklistOption } from '../components/FilterValueChecklist';
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
    placeholder: string;
    disabled: boolean;
  };
  summaryText: string;
  isFiltering: boolean;
  applyFilter: () => Promise<void>;
  applyButtonDisabled: boolean;
  preview: FilterPreviewConfig;
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
    regex: false,
    caseSensitive: false,
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
  const [optionSearchQueries, setOptionSearchQueries] = useState<Record<string, string>>({});
  const categoricalOptionsRef = useRef(categoricalOptions);
  categoricalOptionsRef.current = categoricalOptions;

  const availableColumns = (() => {
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
    } else if (selectedNode?.schema) {
      Object.keys(selectedNode.schema as Record<string, unknown>).forEach((colName) => {
        columns.push({ name: colName, dataType: 'string' });
      });
    }

    return columns;
  })();

  const hasSelection = Boolean(selectedNodeId);
  const hasSchema = availableColumns.length > 0;
  const isSchemaLoading = hasSelection && !hasSchema && (isLoading.nodeData || isLoading.graph);
  const isConfigDisabled = !hasSelection || !hasSchema;

  const workspaceNodeMap = (() => {
    const map = new Map<string, WorkspaceNodeLike>();
    workspaceNodes.forEach((node: WorkspaceNodeLike) => {
      const key = (node.id as string | undefined) ?? ((node as Record<string, unknown>).node_id as string | undefined);
      if (key) {
        map.set(key, node);
      }
    });
    return map;
  })();

  const filterSelectedNodesForPanel = (() => {
    if (!selectedNodeId) return [];
    const node = workspaceNodeMap.get(selectedNodeId);
    return node ? [node] : [];
  })();

  // Identity stability: used in useEffect dependency array via ensureCategoricalOptions
  const getCategoricalKey = useCallback((column: string) => `${currentWorkspaceId ?? 'none'}::${selectedNodeId ?? 'none'}::${column}`, [currentWorkspaceId, selectedNodeId]);

  // Identity stability: used in useEffect dependency array
  const ensureCategoricalOptions = useCallback(async (column: string, dataType: string) => {
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
        const response = await nodesApi.uniqueValues(selectedNodeId, column);
        const rawValues: unknown[] = Array.isArray(response?.unique_values) ? response.unique_values : [];
        const includeNullOption = dataType === 'categorical';
        const hasNullFromResponse = includeNullOption && Boolean(response?.has_null);
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
    }, [getCategoricalKey, currentWorkspaceId, selectedNodeId]);

  const filterDefaultPalette = ['#2563eb', '#dc2626', '#16a34a', '#f97316', '#d946ef', '#0ea5e9'];

  const filterNodeColors = (() => {
    if (!selectedNodeId) return {} as Record<string, string>;
    return { [selectedNodeId]: filterDefaultPalette[0] ?? '#2563eb' };
  })();

  const filterNodeSelections: NodeColumnSelection[] = selectedNodeId ? [{ nodeId: selectedNodeId, column: '' }] : [];

  const handleFilterColorChange = () => undefined;
  const handleFilterColumnChange = () => undefined;

  useEffect(() => {
    setCategoricalOptions({});
    setOptionSearchQueries({});
  }, [currentWorkspaceId, selectedNodeId]);

  useEffect(() => {
    if (!currentWorkspaceId || !selectedNodeId) {
      return;
    }

    conditions.forEach((condition) => {
      if (
        (condition.dataType === 'categorical' || condition.dataType === 'list_string') &&
        condition.column
      ) {
        const key = getCategoricalKey(condition.column);
        if (!categoricalOptionsRef.current[key]) {
          void ensureCategoricalOptions(condition.column, condition.dataType);
        }
      }
    });
  }, [conditions, currentWorkspaceId, selectedNodeId, getCategoricalKey, ensureCategoricalOptions]);

  useEffect(() => {
    setNewNodeName('');
  }, [selectedNodeId]);

  const autoNodeName = buildFilterAutoNodeName({
    baseName: selectedNode?.name || selectedNodeId,
    conditions,
    logic,
  });

  const previewRequest = (() => {
    if (!conditions.length) return null;
    return buildFilterRequestPayload(conditions, logic);
  })();

  const conditionsComplete = conditions.length > 0 && conditions.every(isConditionComplete);

  const previewRequestSignature = (() => {
    if (!selectedNodeId || !hasSelection) return '';
    if (conditionsComplete && previewRequest) {
      return `${selectedNodeId}::filter::${JSON.stringify(previewRequest)}`;
    }
    return `${selectedNodeId}::raw`;
  })();

  const previewReady = hasSelection;

  const filterPreviewRequest: { nodeId: string; payload: FilterRequest | null } | null = (() => {
    if (!hasSelection || !selectedNodeId) {
      return null;
    }
    return {
      nodeId: selectedNodeId,
      payload: conditionsComplete && previewRequest ? previewRequest : null,
    };
  })();

  const filterPreviewFetcher = async ({
    request,
    page,
    pageSize,
    signal: _signal,
  }: {
    request: { nodeId: string; payload: FilterRequest | null };
    page: number;
    pageSize: number;
    signal: AbortSignal;
  }) => {
    if (request.payload) {
      const response = await filterPreview(request.nodeId, request.payload, page, pageSize);
      return {
        data: Array.isArray(response?.data) ? (response.data as PreviewRow[]) : [],
        columns: Array.isArray(response?.columns) ? response.columns : [],
        pagination: response?.pagination ?? null,
      };
    }
    const response = await nodesApi.data(request.nodeId, page, pageSize);
    return {
      data: Array.isArray(response?.data) ? (response.data as PreviewRow[]) : [],
      columns: Array.isArray(response?.columns) ? response.columns : [],
      pagination: response?.pagination ?? null,
    };
  };

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

  const previewColumnsToRender = (() => {
    if (previewColumns.length > 0) return previewColumns;
    if (previewData.length > 0 && typeof previewData[0] === 'object' && previewData[0] !== null) {
      return Object.keys(previewData[0]);
    }
    return [];
  })();

  const currentPreviewPage = previewPagination?.page ?? previewPage;
  const previewHasPrev = Boolean(previewPagination?.has_prev);
  const previewHasNext = Boolean(previewPagination?.has_next);

  const handlePreviewPrev = () => {
    if (previewHasPrev && !previewLoading) {
      setPreviewPage(Math.max(1, currentPreviewPage - 1));
    }
  };

  const handlePreviewNext = () => {
    if (previewHasNext && !previewLoading) {
      setPreviewPage(currentPreviewPage + 1);
    }
  };

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
      regex: false,
      caseSensitive: false,
    };
    setConditions([...conditions, newCondition]);
  };

  const handleRemoveCondition = (id: string) => {
    if (conditions.length > 1) {
      setConditions(conditions.filter(c => c.id !== id));
      setOptionSearchQueries((prev) => {
        const { [id]: _, ...next } = prev;
        return next;
      });
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
          updated.regex = false;
          updated.caseSensitive = false;

          if (columnInfo.dataType === 'categorical' || columnInfo.dataType === 'list_string') {
            nextCategoricalColumnToLoad = columnInfo.name;
          }
          
          if (
            columnInfo.dataType === 'datetime' &&
            selectedNodeId &&
            currentWorkspaceId &&
            nextOperator !== 'is_null'
          ) {
            prefillDatetimeValue(id, columnInfo.name, nextOperator);
          } else if (
            (columnInfo.dataType === 'integer' || columnInfo.dataType === 'float') &&
            selectedNodeId &&
            currentWorkspaceId &&
            (nextOperator === 'gte' || nextOperator === 'lte')
          ) {
            prefillNumericValue(id, columnInfo.name, nextOperator);
          }
        }
      }
      
      if (field === 'operator') {
        if (value === 'in') {
          updated.value = Array.isArray(updated.value) ? updated.value : [];
          if (
            (updated.dataType === 'categorical' || updated.dataType === 'list_string') &&
            updated.column
          ) {
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
        } else if (
          (updated.dataType === 'integer' || updated.dataType === 'float') &&
          updated.column &&
          selectedNodeId &&
          currentWorkspaceId &&
          (value === 'gte' || value === 'lte')
        ) {
          prefillNumericValue(id, updated.column, value as FilterCondition['operator']);
        }
      }
      
      return updated;
    }));

    if (field === 'column' || field === 'operator') {
      setOptionSearchQueries((prev) => ({ ...prev, [id]: '' }));
    }

    if (nextCategoricalColumnToLoad) {
      const targetCondition = conditions.find((entry) => entry.id === id);
      const targetType =
        field === 'column'
          ? availableColumns.find((entry) => entry.name === value)?.dataType
          : targetCondition?.dataType;
      void ensureCategoricalOptions(
        nextCategoricalColumnToLoad,
        targetType === 'categorical' || targetType === 'list_string'
          ? targetType
          : 'categorical',
      );
    }
  };

  const renderConditionMetadata = (condition: FilterConditionWithId, rowDisabled: boolean) => (
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
        <>
          <label className="flex items-center gap-1.5">
            <Checkbox
              id={`regex-${condition.id}`}
              checked={Boolean(condition.regex)}
              onCheckedChange={(checked) => {
                const nextRegex = checked === true;
                setConditions((prev) => prev.map((c) =>
                  c.id !== condition.id ? c : { ...c, regex: nextRegex, caseSensitive: nextRegex ? false : c.caseSensitive }
                ));
              }}
              disabled={rowDisabled}
            />
            <span>regex</span>
          </label>
          <label className="flex items-center gap-1.5">
            <Checkbox
              id={`case-sensitive-${condition.id}`}
              checked={Boolean(condition.caseSensitive)}
              onCheckedChange={(checked) => handleConditionChange(condition.id, 'caseSensitive', checked === true)}
              disabled={rowDisabled || Boolean(condition.regex)}
            />
            <span>case sensitive</span>
          </label>
        </>
      )}
    </div>
  );

  const shouldHideOperatorSelect = (condition: FilterConditionWithId) => (
    condition.dataType === 'categorical' || condition.dataType === 'list_string'
  );

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
      const describeData = await nodesApi.describeColumn(selectedNodeId, column);
      
      setConditions(prev => prev.map(c => {
        if (c.id !== conditionId) return c;
        
        let newValue: ConditionValue;
        
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

  const prefillNumericValue = async (
    conditionId: string,
    column: string,
    operator: FilterCondition['operator']
  ) => {
    if (!selectedNodeId || !currentWorkspaceId) return;

    try {
      const describeData = await nodesApi.describeColumn(selectedNodeId, column);

      setConditions(prev => prev.map(c => {
        if (c.id !== conditionId) return c;

        let newValue: ConditionValue = (c.value as string | number) ?? '';

        switch (operator) {
          case 'gte':
            if (describeData.min !== undefined && describeData.min !== null) {
              newValue = describeData.min;
            }
            break;
          case 'lte':
            if (describeData.max !== undefined && describeData.max !== null) {
              newValue = describeData.max;
            }
            break;
        }

        return { ...c, value: newValue };
      }));
    } catch (error) {
      console.error('Failed to fetch describe data for numeric pre-filling:', error);
    }
  };

  const renderConditionValueInput = (condition: FilterConditionWithId, disabled: boolean) => {
    if (disabled) {
      return (
        <input
          type="text"
          value={condition.operator === 'between' ? '' : String(condition.value ?? '')}
          disabled
          placeholder={hasSelection ? 'Select a column' : 'Select a data block to configure filters'}
          className="flex-1 rounded-md border border-border/70 bg-muted px-2 py-1 text-sm text-muted-foreground"
        />
      );
    }

    const dataType = condition.dataType || 'string';

    if (dataType === 'categorical' || dataType === 'list_string') {
      const column = condition.column;
      const key = column ? getCategoricalKey(column) : null;
      const optionState = key ? categoricalOptions[key] : undefined;
      const optionEntries = optionState?.options ?? [];
      const searchQuery = optionSearchQueries[condition.id] ?? '';
      const selectedValues = Array.isArray(condition.value)
        ? (condition.value as Array<unknown>).map(toCategoricalPrimitive)
        : [];
      const selectedKeys = new Set(selectedValues.map((entry) => getCategoricalOptionKey(entry)));
      const isLoadingOptions = optionState?.loading ?? false;
      const optionError = optionState?.error ?? null;

      const updateSelections = (nextSelections: CategoricalPrimitive[]) => {
        handleConditionChange(condition.id, 'value', nextSelections);
      };

      const toggleValue = (entry: FilterChecklistOption, nextChecked: boolean) => {
        if (disabled) return;
        if (nextChecked) {
          if (selectedKeys.has(entry.key)) return;
          updateSelections([...selectedValues, toCategoricalPrimitive(entry.value)]);
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

      const handleSelectVisible = (visibleOptions: FilterChecklistOption[]) => {
        if (disabled) return;
        const merged = new Map<string, CategoricalPrimitive>(
          selectedValues.map((entry) => [getCategoricalOptionKey(entry), entry]),
        );
        visibleOptions.forEach((entry) => {
          merged.set(entry.key, toCategoricalPrimitive(entry.value));
        });
        updateSelections(Array.from(merged.values()));
      };

      const handleClearAll = () => {
        if (disabled) return;
        updateSelections([]);
      };

      const onSelectAllForMode = searchQuery.trim().length > 0 ? handleSelectVisible : () => handleSelectAll();

      return (
        <FilterValueChecklist
          idPrefix={condition.id}
          options={optionEntries}
          selectedKeys={selectedKeys}
          disabled={disabled}
          loading={isLoadingOptions}
          error={optionError}
          searchQuery={searchQuery}
          onSearchQueryChange={(query) => setOptionSearchQueries((prev) => ({ ...prev, [condition.id]: query }))}
          onToggleOption={toggleValue}
          onSelectAll={onSelectAllForMode}
          onClearAll={handleClearAll}
          onRetry={column ? () => ensureCategoricalOptions(column, dataType) : undefined}
        />
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
      onAlert('Please select a data block first');
      return;
    }

    if (conditions.length === 0 || conditions.some((condition) => !isConditionComplete(condition))) {
      onAlert('Please fill in all filter conditions');
      return;
    }

    const requestName = newNodeName.trim() || autoNodeName;
    const request: FilterRequest = buildFilterRequestPayload(conditions, logic, requestName);

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
    ? 'Select a data block to preview filtered results.'
    : 'Showing original data. Configure conditions to preview filtered rows.';

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
      placeholder: autoNodeName,
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
    selectedNodesOriginalCount: selectedNodes.length,
  };
};
