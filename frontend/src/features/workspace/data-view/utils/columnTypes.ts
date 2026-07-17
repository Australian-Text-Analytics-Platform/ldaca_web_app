import type { Field } from 'apache-arrow';

import type { ArrowColumn, ColumnKind } from '@/lib/arrow/arrowTable';

export interface ColumnInfo {
  name: string;
  /** UI behavior derived from the authoritative Arrow field. */
  dataType: ColumnKind;
  field: Field;
}

export const mapArrowColumnsToInfo = (columns: ArrowColumn[]): ColumnInfo[] =>
  columns.map(({ name, kind, field }) => ({ name, dataType: kind, field }));

/**
 * Narrow `columns` to entries whose `dataType` appears in `allowedTypes`.
 * If `allowedTypes` is empty the list is returned as-is (no-op filter).
 */
/** Used by: shared column selectors and schema/type-management helpers. */
export const filterColumnsByType = (
  columns: ColumnInfo[],
  allowedTypes: string[],
): ColumnInfo[] => {
  if (!allowedTypes.length) return columns;
  const allowed = new Set(allowedTypes.map((t) => t.toLowerCase()));
  return columns.filter((column) => allowed.has(column.dataType.toLowerCase()));
};
