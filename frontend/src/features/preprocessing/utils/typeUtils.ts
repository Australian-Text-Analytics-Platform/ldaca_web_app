// Canonical implementation lives in `@/utils/columnTypes`. Re-exported
// here so preprocessing call sites can keep their existing import.
export { normalizeTypeName } from '@/utils/columnTypes';

/**
 * Get available filter operators for each data type
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
      return [
        { value: 'in', label: 'is one of' },
      ];
    case 'list_string':
      return [
        { value: 'in', label: 'contains any of' },
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
 * Format a value for display in preview tables
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
      return String(value);
    }
  }
  return String(value);
};

/**
 * Check if a value is non-empty (for validation)
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
