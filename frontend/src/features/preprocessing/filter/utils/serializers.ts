import type {
  ConditionRange,
  ConditionValue,
  FilterCondition,
  FilterConditionWithId,
  FilterRequest,
} from '../../types';
import { hasNonEmptyValue } from '../../utils/typeUtils';

/**
 * Converts UI-only filter condition records into the backend request condition
 * shape. Filter preview and apply paths both call this serializer.
 * Used by: local callers in preprocessing/serializers module because nearby helpers need the same normalization, formatting, or adapter rule without duplicating it.
 * Steps: drop incomplete rows, normalize range/date/list values, and preserve boolean/regex
 * flags for backend request payloads.
 */
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
            /**
             * Normalizes one range edge to the nullable ISO/string payload expected by the API.
             * Called by: serializeConditionsForRequest internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
             */
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
    if (condition.caseSensitive !== undefined) payload.case_sensitive = Boolean(condition.caseSensitive);

    return payload;
  });
};

/**
 * Builds a complete FilterRequest from UI conditions, logic, and optional auto
 * node name. Filter preview and apply share this payload builder.
 * Used by: useFilterSubTabSections hook (rg call sites/imports) because those callers need a shared helper boundary for consistent feature state, formatting, or request payloads.
 */
export const buildFilterRequestPayload = (
  conditions: FilterConditionWithId[],
  logic: string,
  newNodeName?: string,
): FilterRequest => ({
  conditions: serializeConditionsForRequest(conditions),
  logic,
  new_node_name: newNodeName && newNodeName.trim() ? newNodeName : undefined,
});

/**
 * Determines whether a condition is ready to send to preview/apply. Filter
 * buttons and preview payload construction use this validation gate.
 * Used by: useFilterSubTabSections hook, autoNodeNames utilities (rg call sites/imports) because those callers need a shared helper boundary for consistent feature state, formatting, or request payloads.
 * Flow: require a column, allow null checks without values, accept either side of between ranges, and otherwise require a non-empty value.
 */
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
