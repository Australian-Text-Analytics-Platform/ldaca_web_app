import { useState, type ReactNode } from 'react';
import { describeColumn } from '@/api';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { Checkbox } from '@/components/ui/checkbox';
import type {
  NodeColumnSelection,
  WorkspaceNodeLike,
} from '@/features/views/common/nodeSelectionTypes';
import { normalizeTypeName, getOperatorsForType } from '../../utils/typeUtils';
import { buildFilterAutoNodeName } from '../../utils/autoNodeNames';
import { buildSingleNodeSelectionPanelModel } from '../../utils/nodeMetadata';
import { useNodePreviewWithRawFallback } from '../../hooks/useNodePreviewWithRawFallback';
import { buildFilterRequestPayload, isConditionComplete } from '../utils/serializers';
import { applyFilterConditionFieldChange, createFilterCondition } from '../utils/conditionState';
import { FilterConditionValueInput } from '../components/FilterConditionValueInput';
import { useFilterCategoricalOptions } from './useFilterCategoricalOptions';
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
  renderValueInput: (condition: FilterConditionWithId, disabled: boolean) => ReactNode;
  renderConditionMetadata: (condition: FilterConditionWithId, rowDisabled: boolean) => ReactNode;
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

/**
 * Owns the Filter sub-tab state and backend request wiring. `FilterSubTab`
 * consumes this hook for condition editing, preview fallback, and apply state.
 * Used by: FilterSubTab, ConditionBuilder, and FilterConditionValueInput because
 * those callers need shared filter state, backend option loading, preview
 * payloads, and apply behavior without owning the hook internals.
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
  const [newNodeNameState, setNewNodeNameState] = useState<{
    nodeId: string | null;
    value: string;
  }>({ nodeId: selectedNodeId, value: '' });
  const [isFiltering, setIsFiltering] = useState(false);
  const {
    categoricalOptions,
    optionSearchQueries,
    getCategoricalKey,
    ensureCategoricalOptions,
    setOptionSearchQuery,
    resetOptionSearchQuery,
    removeOptionSearchQuery,
  } = useFilterCategoricalOptions({
    currentWorkspaceId,
    selectedNodeId,
    conditions,
    getAuthHeaders,
  });

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
      Object.keys(selectedNode.schema).forEach((colName) => {
        columns.push({ name: colName, dataType: 'string' });
      });
    }

    return columns;
  })();

  const hasSelection = Boolean(selectedNodeId);
  const hasSchema = availableColumns.length > 0;
  const isSchemaLoading = hasSelection && !hasSchema && (isLoading.nodeData || isLoading.graph);
  const isConfigDisabled = !hasSelection || !hasSchema;

  const selectionPanelModel = buildSingleNodeSelectionPanelModel({
    nodeId: selectedNodeId,
    workspaceNodes,
  });
  const newNodeName = newNodeNameState.nodeId === selectedNodeId ? newNodeNameState.value : '';
  const setNewNodeName = (value: string) => {
    setNewNodeNameState({ nodeId: selectedNodeId, value });
  };

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

  const autoNodeName = buildFilterAutoNodeName({
    // Empty node name should fall back to the id, so keep `||`.
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
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
    setConditions([...conditions, createFilterCondition(Date.now().toString(), firstColumn)]);
  };

  /**
   * Removes a condition row and its associated checklist search state.
   * Called by: useFilterSubTabSections internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const handleRemoveCondition = (id: string) => {
    if (conditions.length > 1) {
      setConditions(conditions.filter((c) => c.id !== id));
      removeOptionSearchQuery(id);
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
    const targetCondition = conditions.find((condition) => condition.id === id);
    if (!targetCondition) return;

    const { condition, checklistLoadRequest, prefillRequest, shouldResetSearch } =
      applyFilterConditionFieldChange({
        condition: targetCondition,
        field,
        value,
        availableColumns,
      });

    setConditions(
      conditions.map((entry) => {
        if (entry.id !== id) return entry;
        return condition;
      }),
    );

    if (shouldResetSearch) {
      resetOptionSearchQuery(id);
    }

    if (prefillRequest && selectedNodeId && currentWorkspaceId) {
      if (prefillRequest.kind === 'datetime') {
        void prefillDatetimeValue(
          prefillRequest.conditionId,
          prefillRequest.column,
          prefillRequest.operator,
        );
      } else {
        void prefillNumericValue(
          prefillRequest.conditionId,
          prefillRequest.column,
          prefillRequest.operator,
        );
      }
    }

    if (checklistLoadRequest) {
      void ensureCategoricalOptions(checklistLoadRequest.column, checklistLoadRequest.dataType);
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
          onCheckedChange={(checked) => {
            handleConditionChange(condition.id, 'negate', checked === true);
          }}
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
                handleConditionChange(condition.id, 'regex', checked === true);
              }}
              disabled={rowDisabled}
            />
            <span>regex</span>
          </label>
          <label className="flex items-center gap-1.5">
            <Checkbox
              id={`case-sensitive-${condition.id}`}
              checked={Boolean(condition.caseSensitive)}
              onCheckedChange={(checked) => {
                handleConditionChange(condition.id, 'caseSensitive', checked === true);
              }}
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
    condition.dataType === 'categorical' ||
    condition.dataType === 'list[string]' ||
    // tmdist renders its own topic + operator + value controls together so the
    // topic dropdown can sit before the operator.
    condition.dataType === 'tmdist';

  /**
   * Supplies type-aware operator options to the shared ConditionBuilder.
   * Called by: useFilterSubTabSections internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const getConditionOperatorOptions = (condition: FilterConditionWithId) =>
    // Empty dataType should fall back to 'string', so keep `||`.
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
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

          // describeData stats come from the API; empty/falsy values should fall
          // back to '', so keep `||` here.
          /* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
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
          /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */

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

          let newValue: ConditionValue = c.value ?? '';

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
   * Renders the value editor matching the condition's column type.
   * Rendered by: ConditionBuilder via the Filter hook so value-editor UI stays
   * in `FilterConditionValueInput` while this hook keeps data loading and form
   * state ownership.
   */
  const renderConditionValueInput = (condition: FilterConditionWithId, disabled: boolean) => (
    <FilterConditionValueInput
      condition={condition}
      disabled={disabled}
      hasSelection={hasSelection}
      categoricalOptions={categoricalOptions}
      optionSearchQueries={optionSearchQueries}
      getCategoricalKey={getCategoricalKey}
      ensureCategoricalOptions={ensureCategoricalOptions}
      onOptionSearchQueryChange={setOptionSearchQuery}
      onConditionChange={handleConditionChange}
    />
  );

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
      : `${String(conditions.length)} condition${conditions.length === 1 ? '' : 's'} configured (${logic.toUpperCase()} logic).`;

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
      selectedNodes: selectionPanelModel.selectedNodes,
      nodeColumnSelections: selectionPanelModel.nodeColumnSelections,
      nodeColors: selectionPanelModel.nodeColors,
      defaultPalette: selectionPanelModel.defaultPalette,
      onColumnChange: handleFilterColumnChange,
      onColorChange: handleFilterColorChange,
      disabled: selectionPanelModel.disabled,
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
