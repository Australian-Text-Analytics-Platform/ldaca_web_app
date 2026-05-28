import { type NodeSchemaResponse } from '@/features/workspace/data-view/types';

// Canonical implementation lives in `@/utils/columnTypes`. Re-exported
// here so workspace/data-view call sites can keep their existing import.
export { normalizeTypeName } from '@/features/workspace/data-view/utils/columnTypes';

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

/**
 * Normalizes node schema responses into a column-to-dtype map for headers.
 * Used by: useColumnMutations hook (rg call sites/imports).
 * Why: because column mutation UI needs backend schema types normalized before rendering cast options and labels.
 */
export const extractColumnTypes = (
  schema: NodeSchemaResponse | null | undefined,
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

/**
 * Displays known dtype values with UI labels while preserving unknown types.
 * Used by: WorkspaceTable component (rg call sites/imports).
 * Why: because column mutation UI needs backend schema types normalized before rendering cast options and labels.
 */
export const getTypeDisplayName = (type: string): string => {
  const dataType = DATA_TYPES.find((entry) => entry.value === type);
  return dataType ? dataType.label : type;
};
