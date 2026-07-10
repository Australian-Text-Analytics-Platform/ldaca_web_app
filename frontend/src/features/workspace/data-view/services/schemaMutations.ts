import type { WorkspaceNodeInfo } from '@/api';

export const DATA_TYPES = [
  { value: 'string', label: 'string' },
  { value: 'annotation', label: 'annotation' },
  { value: 'categorical', label: 'categorical' },
  { value: 'integer', label: 'integer' },
  { value: 'float', label: 'float' },
  { value: 'boolean', label: 'boolean' },
  { value: 'datetime', label: 'datetime' },
  { value: 'list[string]', label: 'list[string]' },
] as const;

/**
 * Normalizes node schema responses into a column-to-dtype map for headers.
 * Used by: useColumnMutations hook (rg call sites/imports).
 * Why: because column mutation UI needs backend schema types normalized before rendering cast options and labels.
 */
export const extractColumnTypes = (
  nodeInfo: WorkspaceNodeInfo | null | undefined,
): Record<string, string> => {
  return nodeInfo?.schema ?? {};
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
