import { useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { queryWorkspaceSqlTable, sqlIdentifier, sqlTable } from '@/api';
import { Checkbox } from '@/components/ui/checkbox';
import type { WorkspaceNodeMetadata } from '@/features/workspace/common/workspaceNodeMetadata';
import {
  isArrowDictionaryField,
  isArrowStringField,
  isArrowStringListField,
} from '@/lib/arrow/arrowTable';
import { isTopicDistributionField } from '@/lib/arrow/semanticTypes';
import { getOperatorsForField } from '../../utils/typeUtils';
import { buildFilterAutoNodeName } from '../../utils/autoNodeNames';
import {
  useNodePreviewWithRawFallback,
  type OperationPreviewFetcher,
} from '../../hooks/useNodePreviewWithRawFallback';
import { buildFilterRequestPayload, isConditionComplete } from '../utils/serializers';
import { applyFilterConditionFieldChange, createFilterCondition } from '../utils/conditionState';
import { FilterConditionValueInput } from '../components/FilterConditionValueInput';
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
import type { PreprocessingApplyMode } from '../../preprocessingApplyMode';

export interface FilterSubTabProps {
  selectedNodeId: string | null;
  selectedNode: WorkspaceNodeMetadata | null;
  columnOptions: ConditionColumnOption[];
  currentWorkspaceId: string | null;
  applyMode: PreprocessingApplyMode;
  filterNode: (
    nodeId: string,
    request: FilterRequest,
    mode: PreprocessingApplyMode,
  ) => Promise<unknown>;
  filterPreview: OperationPreviewFetcher<FilterRequest>;
  isLoading: {
    operations: boolean;
  };
  onAlert: (message: string) => void;
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
  getOperatorOptions: (condition: FilterConditionWithId) => ReturnType<typeof getOperatorsForField>;
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
  schemaState: {
    hasSelection: boolean;
    hasSchema: boolean;
    isConfigDisabled: boolean;
  };
  conditionBuilder: FilterConditionBuilderConfig;
  newNodeInput: {
    value: string;
    setValue: (value: string) => void;
    placeholder: string;
    disabled: boolean;
  };
  isFiltering: boolean;
  applyFilter: () => Promise<void>;
  applyButtonDisabled: boolean;
  applyButtonDisabledReason: string | undefined;
  preview: FilterPreviewConfig;
}

async function sampleColumnBounds(workspaceId: string, nodeId: string, column: string) {
  const identifier = sqlIdentifier(column);
  const data = await queryWorkspaceSqlTable({
    path: { workspace_id: workspaceId },
    body: {
      mode: 'query',
      node_ids: [nodeId],
      sql: `SELECT MIN(${identifier}) AS minimum, MAX(${identifier}) AS maximum, MEDIAN(${identifier}) AS median FROM ${sqlTable(nodeId)}`,
      page: 1,
      page_size: 1,
    },
  });
  const row = data.rows[0];
  return {
    min: row?.minimum as string | number | undefined,
    max: row?.maximum as string | number | undefined,
    median: row?.median as string | number | undefined,
  };
}

async function countColumnMissingValues(workspaceId: string, nodeId: string, column: string) {
  const identifier = sqlIdentifier(column);
  const data = await queryWorkspaceSqlTable({
    path: { workspace_id: workspaceId },
    body: {
      mode: 'query',
      node_ids: [nodeId],
      sql: `SELECT COUNT(*) - COUNT(${identifier}) AS missing_count FROM ${sqlTable(nodeId)}`,
      page: 1,
      page_size: 1,
    },
  });
  const count = Number(data.rows[0]?.missing_count ?? 0);
  return Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
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
    columnOptions,
    currentWorkspaceId,
    applyMode,
    filterNode,
    filterPreview,
    isLoading,
    onAlert,
  } = props;
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
  const latestMissingValueChecks = useRef(new Map<string, string>());
  const optionSearchScope = `${currentWorkspaceId ?? ''}\0${selectedNodeId ?? ''}`;
  const [optionSearchState, setOptionSearchState] = useState<{
    scope: string;
    values: Record<string, string>;
  }>({ scope: optionSearchScope, values: {} });
  const optionSearchQueries =
    optionSearchState.scope === optionSearchScope ? optionSearchState.values : {};
  const updateOptionSearchQueries = (
    update: (current: Record<string, string>) => Record<string, string>,
  ) => {
    setOptionSearchState((current) => ({
      scope: optionSearchScope,
      values: update(current.scope === optionSearchScope ? current.values : {}),
    }));
  };
  const setOptionSearchQuery = (conditionId: string, query: string) => {
    updateOptionSearchQueries((current) => ({ ...current, [conditionId]: query }));
  };
  const resetOptionSearchQuery = (conditionId: string) => {
    updateOptionSearchQueries((current) => ({ ...current, [conditionId]: '' }));
  };
  const removeOptionSearchQuery = (conditionId: string) => {
    updateOptionSearchQueries((current) => {
      const { [conditionId]: _removed, ...next } = current;
      return next;
    });
  };

  const availableColumns = columnOptions.filter((option) => option.name.length > 0);

  const hasSelection = Boolean(selectedNodeId);
  const hasSchema = availableColumns.length > 0;
  const isConfigDisabled = !hasSelection || !hasSchema;

  const newNodeName = newNodeNameState.nodeId === selectedNodeId ? newNodeNameState.value : '';
  const setNewNodeName = (value: string) => {
    setNewNodeNameState({ nodeId: selectedNodeId, value });
  };

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
    workspaceId: currentWorkspaceId,
    nodeId: selectedNodeId,
    operationPayload,
    operationFetch: filterPreview,
    operation: 'filter',
    enabled: hasSelection,
  });

  const currentPreviewPage = previewPagination?.page ?? previewPage;

  /**
   * Adds a new filter condition seeded from the first available column.
   * Returned as `conditionBuilder.onAddCondition` for `ConditionBuilder`.
   * Steps: pick the first column, choose its default operator/value, create a stable row id,
   * and append the new condition.
   */
  const handleAddCondition = () => {
    const firstColumn = availableColumns[0];
    setConditions((current) => [
      ...current,
      createFilterCondition(Date.now().toString(), firstColumn),
    ]);
  };

  /**
   * Removes a condition row and its associated checklist search state.
   * Returned as `conditionBuilder.onRemoveCondition` for `ConditionBuilder`.
   */
  const handleRemoveCondition = (id: string) => {
    if (conditions.length > 1) {
      setConditions(conditions.filter((c) => c.id !== id));
      removeOptionSearchQuery(id);
      latestMissingValueChecks.current.delete(id);
    }
  };

  const warnAboutMissingValues = async (conditionId: string, column: string) => {
    if (!selectedNodeId || !currentWorkspaceId || !column) return;

    const requestKey = `${currentWorkspaceId}\0${selectedNodeId}\0${column}`;
    latestMissingValueChecks.current.set(conditionId, requestKey);

    try {
      const missingCount = await countColumnMissingValues(
        currentWorkspaceId,
        selectedNodeId,
        column,
      );
      if (latestMissingValueChecks.current.get(conditionId) !== requestKey || missingCount === 0) {
        return;
      }
      toast.warning(
        `Found ${missingCount.toLocaleString()} missing ${missingCount === 1 ? 'value' : 'values'} in “${column}”`,
        {
          description:
            'Rows with missing values won’t match ordinary filter conditions. Choose “is null” to target them.',
        },
      );
    } catch {
      // Missing-value counts are advisory and must not block filter configuration.
    }
  };

  /**
   * Updates one condition field while keeping operator defaults, typed values,
   * and lazy categorical/datetime/numeric prefill in sync.
   * Used by condition metadata controls and returned to `ConditionBuilder` as
   * `onConditionChange`.
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

    if (field === 'column' && typeof value === 'string') {
      void warnAboutMissingValues(id, value);
    }

    const { condition, prefillRequest, shouldResetSearch } = applyFilterConditionFieldChange({
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
  };

  /**
   * Renders row-level filter flags used by string and negated conditions.
   * Rendered by: useFilterSubTabSections JSX render path.
   * Flow: inspect the condition type/operator, fetch checklist state when relevant, and
   * render loading/error/search metadata beside the condition.
   */
  const renderConditionMetadata = (condition: FilterConditionWithId, rowDisabled: boolean) => (
    <div className="flex items-center gap-2 text-label-secondary text-description">
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

      {condition.field &&
        isArrowStringField(condition.field) &&
        condition.operator === 'contains' && (
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
   * Returned as `conditionBuilder.shouldHideOperatorSelect`.
   */
  const shouldHideOperatorSelect = (condition: FilterConditionWithId) =>
    (condition.field !== undefined &&
      (isArrowDictionaryField(condition.field) || isArrowStringListField(condition.field))) ||
    // Topic Distribution renders its own topic + operator + value controls together so the
    // topic dropdown can sit before the operator.
    isTopicDistributionField(condition.field);

  /**
   * Supplies type-aware operator options to the shared ConditionBuilder.
   * Returned as `conditionBuilder.getOperatorOptions`.
   */
  const getConditionOperatorOptions = (condition: FilterConditionWithId) =>
    getOperatorsForField(condition.field);

  /**
   * Prefills datetime filters from column stats to reduce empty preview states.
   * Called by `handleConditionChange` when a datetime column/operator is selected.
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
      const describeData = await sampleColumnBounds(currentWorkspaceId, selectedNodeId, column);

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
   * Called by `handleConditionChange` when a numeric column/operator is selected.
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
      const describeData = await sampleColumnBounds(currentWorkspaceId, selectedNodeId, column);

      setConditions((prev) =>
        prev.map((c) => {
          if (c.id !== conditionId) return c;

          let newValue: ConditionValue = c.value ?? '';

          switch (operator) {
            case 'gte':
              if (describeData.min !== undefined) newValue = describeData.min;
              break;
            case 'lte':
              if (describeData.max !== undefined) newValue = describeData.max;
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
      workspaceId={currentWorkspaceId}
      nodeId={selectedNodeId}
      columnOption={availableColumns.find((option) => option.name === condition.column)}
      optionSearchQueries={optionSearchQueries}
      onOptionSearchQueryChange={setOptionSearchQuery}
      onConditionChange={handleConditionChange}
    />
  );

  /**
   * Validates and applies the configured filter as a new workspace node.
   * Returned to `FilterSubTab` as `applyFilter` for the Apply button.
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
      await filterNode(selectedNodeId, request, applyMode);
    } catch (error) {
      onAlert(`Error applying filter: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsFiltering(false);
    }
  };
  const previewReadyMessage = !hasSelection
    ? 'Select a data block to preview filtered results.'
    : 'Showing original data. Configure conditions to preview filtered results.';

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
    schemaState: {
      hasSelection,
      hasSchema,
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
      ready: hasSelection,
      readyMessage: previewReadyMessage,
      page: currentPreviewPage,
      pageSize: previewPageSize,
      onPageChange: setPreviewPage,
      onPageSizeChange: setPreviewPageSize,
    },
  };
};
