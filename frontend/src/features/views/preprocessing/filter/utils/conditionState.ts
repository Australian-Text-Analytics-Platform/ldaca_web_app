import { getOperatorsForType } from '../../utils/typeUtils';
import type {
  ConditionColumnOption,
  ConditionValue,
  FilterCondition,
  FilterConditionWithId,
} from '../../types';

type ChecklistDataType = 'categorical' | 'list[string]' | 'tmdist';

interface FilterConditionPrefillRequest {
  kind: 'datetime' | 'numeric';
  conditionId: string;
  column: string;
  operator: FilterCondition['operator'];
}

interface FilterConditionLoadRequest {
  column: string;
  dataType: ChecklistDataType;
}

export interface FilterConditionChangeResult {
  condition: FilterConditionWithId;
  checklistLoadRequest: FilterConditionLoadRequest | null;
  prefillRequest: FilterConditionPrefillRequest | null;
  shouldResetSearch: boolean;
}

/**
 * Picks the first supported operator for a column type when filter rows are
 * created or retargeted.
 * Used by: useFilterSubTabSections and condition-state tests so row creation
 * and row updates share one defaulting rule.
 */
const getDefaultOperatorForFilterType = (dataType: string): FilterCondition['operator'] => {
  const operators = getOperatorsForType(dataType);
  return (operators[0]?.value as FilterCondition['operator'] | undefined) ?? 'eq';
};

const isChecklistDataType = (dataType: string | undefined): dataType is ChecklistDataType =>
  dataType === 'categorical' || dataType === 'list[string]' || dataType === 'tmdist';

const getDefaultValueForColumn = (
  dataType: string,
  operator: FilterCondition['operator'],
): ConditionValue => {
  if (dataType === 'tmdist') return { topic_id: 0, threshold: 0.05 };
  return operator === 'in' ? [] : '';
};

const getPrefillRequest = (
  conditionId: string,
  dataType: string | undefined,
  column: string | undefined,
  operator: FilterCondition['operator'],
): FilterConditionPrefillRequest | null => {
  if (!column || operator === 'is_null') return null;
  if (dataType === 'datetime') {
    return { kind: 'datetime', conditionId, column, operator };
  }
  if (
    (dataType === 'integer' || dataType === 'float') &&
    (operator === 'gte' || operator === 'lte')
  ) {
    return { kind: 'numeric', conditionId, column, operator };
  }
  return null;
};

/**
 * Creates a filter row seeded from the first available column.
 * Used by: useFilterSubTabSections add-condition action so default operator,
 * value, and dtype logic stays aligned with condition updates.
 */
export const createFilterCondition = (
  id: string,
  firstColumn: ConditionColumnOption | undefined,
): FilterConditionWithId => {
  const dataType = firstColumn?.dataType ?? 'string';
  const operator = getDefaultOperatorForFilterType(dataType);
  return {
    id,
    column: firstColumn?.name ?? '',
    operator,
    value: getDefaultValueForColumn(dataType, operator),
    dataType,
    negate: false,
    regex: false,
    caseSensitive: false,
  };
};

/**
 * Applies one user edit to a filter condition and reports side effects the
 * hook should run after state updates.
 * Used by: useFilterSubTabSections so the hook can keep async categorical and
 * prefill requests outside the pure condition transition logic.
 * Flow: update the requested field, reset incompatible value state on column
 * changes, normalize categorical/list values on operator changes, and return
 * checklist-load or prefill requests for the caller.
 */
export const applyFilterConditionFieldChange = <Key extends keyof FilterConditionWithId>({
  condition,
  field,
  value,
  availableColumns,
}: {
  condition: FilterConditionWithId;
  field: Key;
  value: FilterConditionWithId[Key];
  availableColumns: ConditionColumnOption[];
}): FilterConditionChangeResult => {
  const updated = { ...condition, [field]: value };
  let checklistLoadRequest: FilterConditionLoadRequest | null = null;
  let prefillRequest: FilterConditionPrefillRequest | null = null;

  if (field === 'column') {
    const columnInfo = availableColumns.find((column) => column.name === value);
    if (columnInfo) {
      const operator = getDefaultOperatorForFilterType(columnInfo.dataType);
      updated.dataType = columnInfo.dataType;
      updated.operator = operator;
      updated.value = getDefaultValueForColumn(columnInfo.dataType, operator);
      updated.regex = false;
      updated.caseSensitive = false;

      if (isChecklistDataType(columnInfo.dataType)) {
        checklistLoadRequest = { column: columnInfo.name, dataType: columnInfo.dataType };
      }
      prefillRequest = getPrefillRequest(
        condition.id,
        columnInfo.dataType,
        columnInfo.name,
        operator,
      );
    }
  }

  if (field === 'operator') {
    const operator = value as FilterCondition['operator'];
    if (operator === 'in') {
      updated.value = Array.isArray(updated.value) ? updated.value : [];
      if (isChecklistDataType(updated.dataType) && updated.column) {
        checklistLoadRequest = { column: updated.column, dataType: updated.dataType };
      }
    } else if (updated.dataType === 'categorical' && Array.isArray(updated.value)) {
      updated.value = updated.value[0] ?? '';
    }

    if (updated.dataType === 'datetime' && updated.column) {
      updated.value = '';
    }
    prefillRequest = getPrefillRequest(condition.id, updated.dataType, updated.column, operator);
  }

  return {
    condition: updated,
    checklistLoadRequest,
    prefillRequest,
    shouldResetSearch: field === 'column' || field === 'operator',
  };
};
