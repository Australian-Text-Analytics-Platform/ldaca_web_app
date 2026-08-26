import { arrowTypeName, type ArrowColumn, type ArrowField } from '@/lib/arrow/arrowTable';

export const DATA_TYPES = [
  { value: 'string', label: 'string' },
  { value: 'categorical', label: 'categorical' },
  { value: 'integer', label: 'integer' },
  { value: 'float', label: 'float' },
  { value: 'datetime', label: 'datetime' },
] as const;

export type ColumnCastType = (typeof DATA_TYPES)[number]['value'];

export const isColumnCastType = (value: string): value is ColumnCastType =>
  DATA_TYPES.some((type) => type.value === value);

/**
 * Indexes decoded Arrow schema fields for headers.
 * Used by useColumnMutations after schema refreshes to update cast controls.
 */
export const extractColumnFields = (
  schema: ArrowColumn[] | null | undefined,
): Record<string, ArrowField> =>
  Object.fromEntries((schema ?? []).map((column) => [column.name, column.field]));

/**
 * Displays the exact extension identity or native Arrow type carried by IPC.
 * Used by WorkspaceTable's column header cast menu.
 */
export const getTypeDisplayName = (field: ArrowField | undefined): string =>
  field ? arrowTypeName(field) : 'unknown';
