import { arrowTypeName, type ArrowColumn, type ArrowField } from '@/lib/arrow/arrowTable';

export interface ColumnInfo {
  name: string;
  /** Exact extension identity or native Apache Arrow type spelling from IPC. */
  typeName: string;
  field: ArrowField;
}

export const mapArrowColumnsToInfo = (columns: ArrowColumn[]): ColumnInfo[] =>
  columns.map(({ name, field }) => ({ name, typeName: arrowTypeName(field), field }));
