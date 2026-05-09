import { type NodeSchemaResponse } from '@/types';

export const DATA_TYPES = [
  { value: 'string', label: 'string' },
  { value: 'annotation', label: 'annotation' },
  { value: 'categorical', label: 'categorical' },
  { value: 'integer', label: 'integer' },
  { value: 'float', label: 'float' },
  { value: 'boolean', label: 'boolean' },
  { value: 'datetime', label: 'datetime' },
  { value: 'list_string', label: 'list_string' },
] as const;

export const extractColumnTypes = (
  schema: NodeSchemaResponse | null | undefined
): Record<string, string> => {
  if (!schema) {
    return {};
  }

  if (schema.column_types && Object.keys(schema.column_types).length > 0) {
    return schema.column_types;
  }

  if (schema.schema && typeof schema.schema === 'object') {
    return schema.schema as Record<string, string>;
  }

  return {};
};

export const normalizeTypeName = (type: string): string => {
  const lowercaseType = type.toLowerCase();
  if (
    lowercaseType === 'annotation' ||
    (lowercaseType.includes('list') &&
      lowercaseType.includes('struct') &&
      lowercaseType.includes('provider') &&
      lowercaseType.includes('annotation'))
  ) {
    return 'annotation';
  }
  if (
    lowercaseType === 'list_string' ||
    lowercaseType.includes('list(string') ||
    lowercaseType.includes('list[utf8') ||
    lowercaseType.includes('list[str')
  ) {
    return 'list_string';
  }
  if (lowercaseType.includes('list') || lowercaseType.includes('array')) return 'unknown';
  if (lowercaseType.includes('utf8') || lowercaseType.includes('string')) return 'string';
  if (lowercaseType.includes('categorical') || lowercaseType.includes('category')) return 'categorical';
  if (lowercaseType.includes('int')) return 'integer';
  if (lowercaseType.includes('float') || lowercaseType.includes('double')) return 'float';
  if (lowercaseType.includes('bool')) return 'boolean';
  if (lowercaseType.includes('date')) return 'datetime';
  if (lowercaseType.includes('datetime')) return 'datetime';
  if (lowercaseType.includes('unknown')) return 'unknown';
  return type;
};

export const getTypeDisplayName = (type: string): string => {
  const dataType = DATA_TYPES.find((entry) => entry.value === type);
  return dataType ? dataType.label : type;
};
