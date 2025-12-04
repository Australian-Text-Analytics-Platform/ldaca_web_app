/**
 * Normalize data type names to standard forms
 */
export const normalizeTypeName = (type: string): string => {
  const lowercaseType = type.toLowerCase();
  if (lowercaseType.includes('utf8') || lowercaseType.includes('string')) return 'string';
  if (lowercaseType.includes('categorical') || lowercaseType.includes('category')) return 'categorical';
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
    case 'categorical':
      return [
        { value: 'in', label: 'is one of' },
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
