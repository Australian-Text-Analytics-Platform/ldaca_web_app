import React, { useCallback, useState, useEffect, useRef } from 'react';
import { describeColumn, getColumnUniqueValues } from '@/api/generated/sdk.gen';
import { useAuth } from '@/features/auth/hooks/useAuth';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import type {
  NodeColumnSelection,
  WorkspaceNodeLike,
} from '@/features/views/common/components/NodeSelectionPanel';
import { DateTimePickerField } from '../../utils/dateTimeUtils';
import { normalizeTypeName, getOperatorsForType, formatPreviewValue } from '../../utils/typeUtils';
import { ISO_PLACEHOLDER } from '../../utils/dateTimeHelpers';
import { buildFilterAutoNodeName } from '../../utils/autoNodeNames';
import { useNodePreviewWithRawFallback } from '../../hooks/useNodePreviewWithRawFallback';
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
  onConditionChange: <Key extends keyof FilterConditionWithId>(
    id: string,
    field: Key,
    value: FilterConditionWithId[Key],
  ) => void;
  renderValueInput: (condition: FilterConditionWithId, disabled: boolean) => React.ReactNode;
  renderConditionMetadata: (
    condition: FilterConditionWithId,
    rowDisabled: boolean,
  ) => React.ReactNode;
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
  onPageChange: (page: number) => void;
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
  applyButtonDisabledReason: string | undefined;
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

/**
 * Normalizes backend unique values into primitives the checklist can compare.
 * Used by: local callers in preprocessing/useFilterSubTabSections module because nearby helpers need the same normalization, formatting, or adapter rule without duplicating it.
 */
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

/**
 * Creates collision-resistant keys for categorical checklist selections.
 * Used by: local callers in preprocessing/useFilterSubTabSections module because nearby helpers need the same normalization, formatting, or adapter rule without duplicating it.
 */
const getCategoricalOptionKey = (value: CategoricalPrimitive): string => {
  if (value === null) return NULL_OPTION_KEY;
  return `${typeof value}::${String(value)}`;
};

/**
 * Picks the first supported operator for a column type when rows are created.
 * Used by: local callers in preprocessing/useFilterSubTabSections module because nearby helpers need the same normalization, formatting, or adapter rule without duplicating it.
 */
const getDefaultOperatorForType = (dataType: string): FilterCondition['operator'] => {
  const operators = getOperatorsForType(dataType);
  return (operators[0]?.value as FilterCondition['operator']) ?? 'eq';
};

/**
 * Builds deduplicated checklist options from `getColumnUniqueValues`. The
 * categorical renderer uses these entries to preserve null handling and labels.
 * Used by: local callers in preprocessing/useFilterSubTabSections module because nearby helpers need the same normalization, formatting, or adapter rule without duplicating it.
 * Steps: convert backend unique values to comparable primitives, deduplicate by type-aware key,
 * prepend null when present, and preserve display labels.
 */
const buildCategoricalOptionEntries = (
  rawValues: unknown[],
  hasNullFromResponse: boolean,
): CategoricalOptionEntry[] => {
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
  return optionList;
};

/**
 * Owns the Filter sub-tab state and backend request wiring. `FilterSubTab`
 * consumes this hook for condition editing, preview fallback, and apply state.
 * Used by: FilterValueChecklist component, FilterSubTab module, ConditionBuilder component (rg call sites/imports) because those callers need a shared helper boundary for consistent feature state, formatting, or request payloads.
 * Flow: derive selected nodes/schema, manage condition rows and categorical options, prefill
 * typed inputs, request previews, and apply complete filter payloads.
 */
export const useFilterSubTabSections = (
  props: FilterSubTabProps,
): UseFilterSubTabSectionsResult => {
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
  const { getAuthHeaders } = useAuth();
  const [conditions, setConditions] = useState<FilterConditionWithId[]>([
    {
      id: '1',
      column: '',
      operator: 'eq',
      value: '',
      negate: false,
      regex: false,
      caseSensitive: false,
    },
  ]);
  const [logic, setLogic] = useState<'and' | 'or'>('and');
  const [newNodeName, setNewNodeName] = useState('');
  const [isFiltering, setIsFiltering] = useState(false);
  const [categoricalOptions, setCategoricalOptions] = useState<
    Record<
      string,
      {
        options: CategoricalOptionEntry[];
        hasNull: boolean;
        loading: boolean;
        error: string | null;
      }
    >
  >({});
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
      const key =
        (node.id as string | undefined) ??
        ((node as Record<string, unknown>).node_id as string | undefined);
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

  /** Keys cached categorical options by workspace, node, and column. */
  const getCategoricalKey = useCallback(
    (column: string) => `${currentWorkspaceId ?? 'none'}::${selectedNodeId ?? 'none'}::${column}`,
    [currentWorkspaceId, selectedNodeId],
  );

  /**
   * Loads categorical/list-string values on demand for checklist conditions.
   * Condition changes and retry buttons call this to populate option state.
   */
  const ensureCategoricalOptions = useCallback(
    async (column: string, dataType: string) => {
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
        const { data: response } = await getColumnUniqueValues({
          headers: getAuthHeaders(),
          path: { column_name: column, node_id: selectedNodeId },
          throwOnError: true,
        });
        const rawValues: unknown[] = Array.isArray(response?.unique_values)
          ? response.unique_values
          : [];
        const includeNullOption = dataType === 'categorical';
        const hasNullFromResponse = includeNullOption && Boolean(response?.has_null);
        const optionList = buildCategoricalOptionEntries(rawValues, hasNullFromResponse);

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
    [getCategoricalKey, currentWorkspaceId, selectedNodeId, getAuthHeaders],
  );

  const filterDefaultPalette = ['#2563eb', '#dc2626', '#16a34a', '#f97316', '#d946ef', '#0ea5e9'];

  const filterNodeColors = (() => {
    if (!selectedNodeId) return {} as Record<string, string>;
    return { [selectedNodeId]: filterDefaultPalette[0] ?? '#2563eb' };
  })();

  const filterNodeSelections: NodeColumnSelection[] = selectedNodeId
    ? [{ nodeId: selectedNodeId, column: '' }]
    : [];

  /**
   * Placeholder color handler because the filter panel uses one fixed color.
   * Called by: useFilterSubTabSections internal event, effect, or helper flow.
   */
  const handleFilterColorChange = () => undefined;
  /**
   * Placeholder column handler because filter columns are edited in conditions.
   * Called by: useFilterSubTabSections internal event, effect, or helper flow.
   */
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

  const previewReady = hasSelection;
  const operationPayload: FilterRequest | null =
    conditionsComplete && previewRequest ? previewRequest : null;

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
  } = useNodePreviewWithRawFallback<FilterRequest>({
    nodeId: selectedNodeId,
    operationPayload,
    operationFetch: filterPreview,
    signaturePrefix: 'filter',
    enabled: previewReady,
  });

  const currentPreviewPage = previewPagination?.page ?? previewPage;

  /**
   * Adds a new filter condition seeded from the first available column.
   * Called by: useFilterSubTabSections internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   * Steps: pick the first column, choose its default operator/value, create a stable row id,
   * and append the new condition.
   */
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

  /**
   * Removes a condition row and its associated checklist search state.
   * Called by: useFilterSubTabSections internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const handleRemoveCondition = (id: string) => {
    if (conditions.length > 1) {
      setConditions(conditions.filter((c) => c.id !== id));
      setOptionSearchQueries((prev) => {
        const { [id]: _, ...next } = prev;
        return next;
      });
    }
  };

  /**
   * Updates one condition field while keeping operator defaults, typed values,
   * and lazy categorical/datetime/numeric prefill in sync.
   * Called by: useFilterSubTabSections internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   * Steps: normalize a row change, reset incompatible value state when column/operator type
   * changes, and trigger categorical loading when needed.
   */
  const handleConditionChange = <Key extends keyof FilterConditionWithId>(
    id: string,
    field: Key,
    value: FilterConditionWithId[Key],
  ) => {
    let nextCategoricalColumnToLoad: string | null = null;

    setConditions(
      conditions.map((c) => {
        if (c.id !== id) return c;

        const updated = { ...c, [field]: value };

        if (field === 'column') {
          const columnInfo = availableColumns.find((col) => col.name === value);
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
              void prefillDatetimeValue(id, columnInfo.name, nextOperator);
            } else if (
              (columnInfo.dataType === 'integer' || columnInfo.dataType === 'float') &&
              selectedNodeId &&
              currentWorkspaceId &&
              (nextOperator === 'gte' || nextOperator === 'lte')
            ) {
              void prefillNumericValue(id, columnInfo.name, nextOperator);
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
              void prefillDatetimeValue(id, updated.column, value as FilterCondition['operator']);
            }
          } else if (
            (updated.dataType === 'integer' || updated.dataType === 'float') &&
            updated.column &&
            selectedNodeId &&
            currentWorkspaceId &&
            (value === 'gte' || value === 'lte')
          ) {
              void prefillNumericValue(id, updated.column, value as FilterCondition['operator']);
          }
        }

        return updated;
      }),
    );

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
        targetType === 'categorical' || targetType === 'list_string' ? targetType : 'categorical',
      );
    }
  };

  /**
   * Renders row-level filter flags used by string and negated conditions.
   * Rendered by: useFilterSubTabSections JSX render path because the parent needs this component boundary to keep feature controls and state presentation isolated.
   * Flow: inspect the condition type/operator, fetch checklist state when relevant, and
   * render loading/error/search metadata beside the condition.
   */
  const renderConditionMetadata = (condition: FilterConditionWithId, rowDisabled: boolean) => (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <label className="flex items-center gap-1.5">
        <Checkbox
          id={`negate-${condition.id}`}
          checked={Boolean(condition.negate)}
          onCheckedChange={(checked) =>
            handleConditionChange(condition.id, 'negate', checked === true)
          }
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
              onCheckedChange={(checked) =>
                handleConditionChange(condition.id, 'regex', checked === true)
              }
              disabled={rowDisabled}
            />
            <span>regex</span>
          </label>
          <label className="flex items-center gap-1.5">
            <Checkbox
              id={`case-sensitive-${condition.id}`}
              checked={Boolean(condition.caseSensitive)}
              onCheckedChange={(checked) =>
                handleConditionChange(condition.id, 'caseSensitive', checked === true)
              }
              disabled={rowDisabled}
            />
            <span>case sensitive</span>
          </label>
        </>
      )}
    </div>
  );

  /**
   * Categorical/list filters use checklist UI instead of an operator select.
   * Called by: useFilterSubTabSections internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const shouldHideOperatorSelect = (condition: FilterConditionWithId) =>
    condition.dataType === 'categorical' || condition.dataType === 'list_string';

  /**
   * Supplies type-aware operator options to the shared ConditionBuilder.
   * Called by: useFilterSubTabSections internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const getConditionOperatorOptions = (condition: FilterConditionWithId) =>
    getOperatorsForType(condition.dataType || 'string');

  /**
   * Prefills datetime filters from column stats to reduce empty preview states.
   * Called by: useFilterSubTabSections internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   * Steps: reuse an existing date/time value when present, otherwise fetch column stats and
   * seed the condition from backend min/max values.
   */
  const prefillDatetimeValue = async (
    conditionId: string,
    column: string,
    operator: FilterCondition['operator'],
  ) => {
    if (!selectedNodeId || !currentWorkspaceId) return;

    try {
      const { data: describeData } = await describeColumn({
        headers: getAuthHeaders(),
        path: { column_name: column, node_id: selectedNodeId },
        throwOnError: true,
      });

      setConditions((prev) =>
        prev.map((c) => {
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
                end: (describeData.max as ConditionRange['end']) || '',
              };
              break;
            default:
              newValue = '';
          }

          return { ...c, value: newValue };
        }),
      );
    } catch {
      // Best-effort prefill; leave the current value unchanged on failure.
    }
  };

  /**
   * Prefills numeric range filters from column min/max stats when available.
   * Called by: useFilterSubTabSections internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   * Steps: reuse existing numeric bounds when present, otherwise describe the column and seed
   * range/equality inputs from backend min/max values.
   */
  const prefillNumericValue = async (
    conditionId: string,
    column: string,
    operator: FilterCondition['operator'],
  ) => {
    if (!selectedNodeId || !currentWorkspaceId) return;

    try {
      const { data: describeData } = await describeColumn({
        headers: getAuthHeaders(),
        path: { column_name: column, node_id: selectedNodeId },
        throwOnError: true,
      });

      setConditions((prev) =>
        prev.map((c) => {
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
        }),
      );
    } catch {
      // Best-effort prefill; leave the current value unchanged on failure.
    }
  };

  /**
   * Renders the value editor matching the condition's column type. The shared
   * ConditionBuilder calls this hook callback for each condition row.
   * Rendered by: useFilterSubTabSections JSX render path because the parent needs this component boundary to keep feature controls and state presentation isolated.
   * Flow: choose the control for categorical, range, datetime, boolean, regex, or scalar
   * conditions, then connect each control to condition updates.
   */
  const renderConditionValueInput = (condition: FilterConditionWithId, disabled: boolean) => {
    if (disabled) {
      return (
        <input
          type="text"
          value={condition.operator === 'between' ? '' : String(condition.value ?? '')}
          disabled
          placeholder={
            hasSelection ? 'Select a column' : 'Select a data block to configure filters'
          }
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

      /**
       * Writes checklist selections back into the condition value field.
       * Called by: renderConditionValueInput internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
       */
      const updateSelections = (nextSelections: CategoricalPrimitive[]) => {
        handleConditionChange(condition.id, 'value', nextSelections);
      };

      /**
       * Toggles one categorical/list-string option in the condition value.
       * Called by: renderConditionValueInput internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
       */
      const toggleValue = (entry: FilterChecklistOption, nextChecked: boolean) => {
        if (disabled) return;
        if (nextChecked) {
          if (selectedKeys.has(entry.key)) return;
          updateSelections([...selectedValues, toCategoricalPrimitive(entry.value)]);
        } else {
          updateSelections(
            selectedValues.filter((current) => getCategoricalOptionKey(current) !== entry.key),
          );
        }
      };

      /**
       * Selects all loaded options for the current checklist condition.
       * Called by: renderConditionValueInput internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
       */
      const handleSelectAll = () => {
        if (disabled) return;
        updateSelections(optionEntries.map((entry) => entry.value));
      };

      /**
       * Adds only the currently visible search results to the selection.
       * Called by: renderConditionValueInput internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
       */
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

      /**
       * Clears all selected values for the current checklist condition.
       * Called by: renderConditionValueInput internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
       */
      const handleClearAll = () => {
        if (disabled) return;
        updateSelections([]);
      };

      const onSelectAllForMode =
        searchQuery.trim().length > 0 ? handleSelectVisible : () => handleSelectAll();

      return (
        <FilterValueChecklist
          idPrefix={condition.id}
          options={optionEntries}
          selectedKeys={selectedKeys}
          disabled={disabled}
          loading={isLoadingOptions}
          error={optionError}
          searchQuery={searchQuery}
          onSearchQueryChange={(query) =>
            setOptionSearchQueries((prev) => ({ ...prev, [condition.id]: query }))
          }
          onToggleOption={toggleValue}
          onSelectAll={onSelectAllForMode}
          onClearAll={handleClearAll}
          onRetry={column ? () => {
            void ensureCategoricalOptions(column, dataType);
          } : undefined}
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
          condition.value &&
          typeof condition.value === 'object' &&
          'start' in (condition.value as Record<string, unknown>)
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

  /**
   * Validates and applies the configured filter as a new workspace node.
   * Called by: useFilterSubTabSections internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   * Steps: require a selected node and complete conditions, serialize the request, call the
   * filter mutation, and clear loading state.
   */
  const handleApplyFilter = async () => {
    if (!selectedNodeId) {
      onAlert('Please select a data block first');
      return;
    }

    if (
      conditions.length === 0 ||
      conditions.some((condition) => !isConditionComplete(condition))
    ) {
      onAlert('Please fill in all filter conditions');
      return;
    }

    const requestName = newNodeName.trim() || autoNodeName;
    const request: FilterRequest = buildFilterRequestPayload(conditions, logic, requestName);

    try {
      setIsFiltering(true);
      await filterNode(selectedNodeId, request);
    } catch (error) {
      onAlert(`Error applying filter: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsFiltering(false);
    }
  };
  const previewReadyMessage = !hasSelection
    ? 'Select a data block to preview filtered results.'
    : 'Showing original data. Configure conditions to preview filtered results.';

  const summaryText =
    conditions.length === 0
      ? 'Define at least one condition to enable preview and filtering.'
      : `${conditions.length} condition${conditions.length === 1 ? '' : 's'} configured (${logic.toUpperCase()} logic).`;

  const hasApplicablePreviewRows =
    conditionsComplete && !previewLoading && !previewError && previewData.length > 0;

  const applyButtonDisabled =
    isConfigDisabled || isFiltering || isLoading.operations || !hasApplicablePreviewRows;

  const applyButtonDisabledReason: string | undefined = (() => {
    if (isFiltering || isLoading.operations) return undefined;
    if (!hasSelection) return 'Select a data block first';
    if (!conditionsComplete) return 'Set at least one complete filtering condition';
    if (!hasApplicablePreviewRows)
      return 'Adjust your conditions until at least one result appears in Preview filtered results';
    return undefined;
  })();

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
    applyButtonDisabledReason,
    preview: {
      columns: previewColumns,
      data: previewData,
      pagination: previewPagination,
      loading: previewLoading,
      error: previewError,
      ready: previewReady,
      readyMessage: previewReadyMessage,
      page: currentPreviewPage,
      pageSize: previewPageSize,
      onPageChange: setPreviewPage,
      onPageSizeChange: setPreviewPageSize,
    },
    selectedNodesOriginalCount: selectedNodes.length,
  };
};
