import type { ArrowColumn, ColumnKind } from '@/lib/arrow/arrowTable';

export const DATA_TYPES = [
  { value: 'string', label: 'string' },
  { value: 'categorical', label: 'categorical' },
  { value: 'integer', label: 'integer' },
  { value: 'float', label: 'float' },
  { value: 'datetime', label: 'datetime' },
] as const;

/**
 * Projects Arrow schema fields into UI semantic kinds for headers.
 * Used by useColumnMutations after schema refreshes to update cast controls.
 */
export const extractColumnTypes = (
  schema: ArrowColumn[] | null | undefined,
): Record<string, ColumnKind> =>
  Object.fromEntries((schema ?? []).map((column) => [column.name, column.kind]));

/**
 * Displays known dtype values with UI labels while preserving unknown types.
 * Used by WorkspaceTable's column header cast menu.
 */
export const getTypeDisplayName = (type: string): string => {
  const dataType = DATA_TYPES.find((entry) => entry.value === type);
  if (dataType) return dataType.label;
  return type.startsWith('extension:') ? type.slice('extension:'.length) : type;
};
