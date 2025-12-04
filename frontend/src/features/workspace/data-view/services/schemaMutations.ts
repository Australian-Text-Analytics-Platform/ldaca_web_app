import { NodeSchemaResponse } from '../../../../types';

interface LegacySchemaEntry {
  name: string;
  js_type?: string;
}

export const DATA_TYPES = [
  { value: 'string', label: 'string' },
  { value: 'categorical', label: 'categorical' },
  { value: 'integer', label: 'integer' },
  { value: 'float', label: 'float' },
  { value: 'boolean', label: 'boolean' },
  { value: 'datetime', label: 'datetime' },
  { value: 'array', label: 'array' },
] as const;

const isLegacySchemaArray = (value: unknown): value is LegacySchemaEntry[] =>
  Array.isArray(value) && value.every((entry) => entry && typeof entry.name === 'string');

export const extractColumnTypes = (
  schema: NodeSchemaResponse | null | undefined
): Record<string, string> => {
  if (!schema) {
    return {};
  }

  const schemaValue = schema.schema as unknown;
  if (isLegacySchemaArray(schemaValue)) {
    return Object.fromEntries(schemaValue.map(({ name, js_type }) => [name, js_type ?? 'string']));
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
  if (lowercaseType.includes('utf8') || lowercaseType.includes('string')) return 'string';
  if (lowercaseType.includes('categorical') || lowercaseType.includes('category')) return 'categorical';
  if (lowercaseType.includes('int')) return 'integer';
  if (lowercaseType.includes('float') || lowercaseType.includes('double')) return 'float';
  if (lowercaseType.includes('bool')) return 'boolean';
  if (lowercaseType.includes('date')) return 'datetime';
  if (lowercaseType.includes('datetime')) return 'datetime';
  if (lowercaseType.includes('list') || lowercaseType.includes('array')) return 'array';
  return type;
};

export const getTypeDisplayName = (type: string): string => {
  const dataType = DATA_TYPES.find((entry) => entry.value === type);
  return dataType ? dataType.label : type;
};
