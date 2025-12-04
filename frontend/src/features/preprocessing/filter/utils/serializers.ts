import type {
  ConditionRange,
  ConditionValue,
  FilterCondition,
  FilterConditionWithId,
  FilterRequest,
} from '../../types';
import { hasNonEmptyValue } from '../../utils/typeUtils';

export const serializeConditionsForRequest = (conditions: FilterConditionWithId[]) => {
  return conditions.map<FilterCondition>((condition) => {
    let value: ConditionValue;
    if (condition.operator === 'is_null') {
      value = null;
    } else if (condition.value instanceof Date) {
      value = condition.value.toISOString();
    } else if (Array.isArray(condition.value)) {
      value = condition.value.map((entry: string | number | boolean | Date | null) =>
        entry instanceof Date ? entry.toISOString() : entry,
      );
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

export const buildFilterRequestPayload = (
  conditions: FilterConditionWithId[],
  logic: string,
  newNodeName?: string,
): FilterRequest => ({
  conditions: serializeConditionsForRequest(conditions),
  logic,
  new_node_name: newNodeName && newNodeName.trim() ? newNodeName : undefined,
});

export const isConditionComplete = (condition: FilterConditionWithId): boolean => {
  if (!condition.column) return false;
  if (condition.operator === 'is_null') return true;
  if (condition.operator === 'between') {
    const range = condition.value && typeof condition.value === 'object'
      ? (condition.value as ConditionRange)
      : { start: null, end: null };
    return hasNonEmptyValue(range.start) || hasNonEmptyValue(range.end);
  }
  return hasNonEmptyValue(condition.value);
};
