/**
 * Supplies condition operators for the Filter tab based on normalized dtype.
 * Used by filter condition state and rendering to choose dtype-aware operators.
 * Flow: normalize the dtype, choose operator sets for numeric/datetime/string/boolean/list
 * types, and return filter-builder options.
 */
export const getOperatorsForType = (dataType: string) => {
  switch (dataType) {
    case 'string':
      return [
        { value: 'contains', label: 'contains' },
        { value: 'eq', label: 'equals' },
        { value: 'startswith', label: 'starts with' },
        { value: 'endswith', label: 'ends with' },
        { value: 'is_null', label: 'is null' },
      ];
    case 'categorical':
      return [{ value: 'in', label: 'is one of' }];
    case 'string-list':
      return [{ value: 'in', label: 'contains any of' }];
    case 'topic-distribution':
      // Topic-distribution: compare one topic's proportion against a threshold.
      return [
        { value: 'gte', label: '≥' },
        { value: 'gt', label: '>' },
        { value: 'lte', label: '≤' },
        { value: 'lt', label: '<' },
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

/**
 * Formats arbitrary preview cell values for tables and checklist labels.
 * Used by categorical-option helpers and `PreviewTable` for readable cell labels.
 * Steps: map nullish/empty primitives to readable labels, preserve scalar text, JSON-stringify
 * objects when possible, and fall back to String conversion.
 */
export const formatPreviewValue = (value: unknown): string => {
  if (value === null) {
    return '(null)';
  }
  if (value === undefined) {
    return '(undefined)';
  }
  if (typeof value === 'string') {
    if (value.trim() === '') {
      return '(empty string)';
    }
    return value;
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'number') {
    return value.toString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      // Last-resort coercion when JSON.stringify fails (e.g. circular refs).
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      return String(value);
    }
  }
  // value is now symbol/bigint/function; String() is the intended last resort.
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  return String(value);
};

/**
 * Checks whether filter condition values are complete enough to serialize.
 * Used by filter request serialization to reject incomplete condition values.
 * Steps: reject nullish/blank values, accept scalar values, recurse arrays and ranges, and
 * inspect object entries for any non-empty value.
 */
export const hasNonEmptyValue = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number' || typeof value === 'boolean') return true;
  if (value instanceof Date) return true;
  if (Array.isArray(value)) {
    if (value.length === 0) return false;
    return value.some((entry) => (entry === null ? true : hasNonEmptyValue(entry)));
  }
  if (typeof value === 'object') {
    const maybeRange = value as { start?: unknown; end?: unknown };
    if ('start' in maybeRange || 'end' in maybeRange) {
      return hasNonEmptyValue(maybeRange.start ?? null) || hasNonEmptyValue(maybeRange.end ?? null);
    }
    return Object.values(value as Record<string, unknown>).some((entry) => hasNonEmptyValue(entry));
  }
  return true;
};
