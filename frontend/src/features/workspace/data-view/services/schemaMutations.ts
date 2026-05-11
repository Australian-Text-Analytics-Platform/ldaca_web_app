import { type NodeSchemaResponse } from '@/types';

// Canonical implementation lives in `@/utils/columnTypes`. Re-exported
// here so workspace/data-view call sites can keep their existing import.
export { normalizeTypeName } from '@/utils/columnTypes';

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

export const getTypeDisplayName = (type: string): string => {
  const dataType = DATA_TYPES.find((entry) => entry.value === type);
  return dataType ? dataType.label : type;
};
