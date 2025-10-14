/**
 * Normalize data type names to standard forms
 */
export const normalizeTypeName = (type: string): string => {
  const lowercaseType = type.toLowerCase();
  if (lowercaseType.includes('utf8') || lowercaseType.includes('string')) return 'string';
  if (lowercaseType.includes('int') && !lowercaseType.includes('interval')) return 'integer';
  if (lowercaseType.includes('float') || lowercaseType.includes('double')) return 'float';
  if (lowercaseType.includes('bool')) return 'boolean';
  if (lowercaseType.includes('datetime') || lowercaseType.includes('timestamp')) return 'datetime';
  if (lowercaseType.includes('list') || lowercaseType.includes('array')) return 'array';
  return 'string'; // Default fallback
};

/**
 * Get available filter operators for each data type
 */
export const getOperatorsForType = (dataType: string) => {
  switch (dataType) {
    case 'string':
      return [
        { value: 'eq', label: 'equals' },
        { value: 'contains', label: 'contains' },
        { value: 'startswith', label: 'starts with' },
        { value: 'endswith', label: 'ends with' },
        { value: 'is_null', label: 'is null' },
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
        { value: 'eq', label: 'equals' },
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
  if (typeof value === 'string') return value.trim() !== '';
  if (typeof value === 'number') return true;
  if (typeof value === 'boolean') return true;
  if (value instanceof Date) return true;
  if (typeof value === 'object') {
    if ('start' in value && 'end' in value) {
      return hasNonEmptyValue((value as { start: unknown }).start) && hasNonEmptyValue((value as { end: unknown }).end);
    }
    return Object.keys(value).length > 0;
  }
  return false;
};
