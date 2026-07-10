import type { ColumnDef } from '@tanstack/react-table';
import type { ConcordanceNodeResult } from '@/api';
import {
  CONCORDANCE_COLUMN_KEYS,
  CONCORDANCE_CORE_COLUMNS,
  CONCORDANCE_FREQ_COLUMNS,
} from '../../common/generatedColumns';
import { flattenConcordanceGroups, toCellText } from '../concordanceTableDomain';

export type ConcordanceRow = Record<string, unknown>;
export type ConcordanceGroupedRow = ConcordanceRow[];

const CORE_COLS = [...CONCORDANCE_CORE_COLUMNS];
const FREQ_COLS = [...CONCORDANCE_FREQ_COLUMNS];
const ALL_CONC_COLS_SET = new Set<string>([...CORE_COLS, ...FREQ_COLS]);

/**
 * Returns the KWIC alignment class for a concordance column.
 * Used by: ConcordanceRowsTable header/cell renderers so combined and per-node
 * tables keep the same left/match/right visual scan line.
 */
export function alignmentClassForColumn(columnKey: string): string {
  if (columnKey === CONCORDANCE_COLUMN_KEYS.leftContext) return 'text-right';
  if (columnKey === CONCORDANCE_COLUMN_KEYS.matchedText) return 'text-center';
  return '';
}

/** Used by: concordance table display-column assembly to remove repeated concordance/metadata keys while preserving first occurrence order. */
export const dedupeColumns = (cols: string[]): string[] => {
  const seen = new Set<string>();
  return cols.filter((col) => {
    if (seen.has(col)) {
      return false;
    }
    seen.add(col);
    return true;
  });
};

/**
 * Builds TanStack column defs for a concordance table.
 * Used by: buildConcordanceTableModel because combined and per-node tables
 * share plain string cell rendering while wrapping headers/cells differently.
 */
function buildConcordanceColumns(displayColumns: string[]): ColumnDef<ConcordanceRow>[] {
  return displayColumns.map((columnKey) => ({
    id: columnKey,
    accessorFn: (row) => row[columnKey],
    cell: ({ getValue }) => toCellText(getValue()),
  }));
}

interface Params {
  nodeData: ConcordanceNodeResult;
  showMetadata: boolean;
  selectedMetadataColumns: string[];
  fallbackToAllColumns?: boolean;
}

export interface ConcordanceTableModel {
  rows: ConcordanceRow[];
  tableColumns: string[];
  columns: ColumnDef<ConcordanceRow>[];
}

/**
 * Builds the shared row/column model for table-oriented concordance blocks.
 *
 * Used by: CombinedConcordanceTable and PerNodeConcordanceTable so grouped-row
 * flattening, generated concordance column filtering, metadata selection, and
 * duplicate-column removal remain identical across both table branches.
 */
export function buildConcordanceTableModel({
  nodeData,
  showMetadata,
  selectedMetadataColumns,
  fallbackToAllColumns = false,
}: Params): ConcordanceTableModel {
  const rows = flattenConcordanceGroups(nodeData.data);
  const allColumns = nodeData.columns;
  const metadataColumns = nodeData.metadata.metadata_columns;
  const concordanceColumns = nodeData.metadata.concordance_columns.length
    ? nodeData.metadata.concordance_columns.filter((columnName) =>
        ALL_CONC_COLS_SET.has(columnName),
      )
    : CORE_COLS;
  const visibleMetadataColumns = selectedMetadataColumns.filter((columnName) =>
    metadataColumns.includes(columnName),
  );
  const rawDisplayColumns = showMetadata
    ? [
        ...concordanceColumns.filter((columnName) => allColumns.includes(columnName)),
        ...visibleMetadataColumns.filter((columnName) => allColumns.includes(columnName)),
      ]
    : concordanceColumns.filter((columnName) => allColumns.includes(columnName));
  const displayColumns = dedupeColumns(rawDisplayColumns);
  const tableColumns =
    fallbackToAllColumns && displayColumns.length === 0 ? allColumns : displayColumns;

  return {
    rows,
    tableColumns,
    columns: buildConcordanceColumns(tableColumns),
  };
}
