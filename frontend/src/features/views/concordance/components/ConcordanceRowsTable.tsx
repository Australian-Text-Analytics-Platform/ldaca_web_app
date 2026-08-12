import { flexRender, type Header, type Table as TanStackTable } from '@tanstack/react-table';
import type { CSSProperties, ReactNode } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PaginatedTableProcessingRow } from '@/features/views/common/components/PaginatedTableProcessingRow';
import { GREY, toBgColor } from '@/features/views/common/vizPalette';
import { DisabledReasonTooltip } from '@/components/ui/disabled-reason-tooltip';
import { alignmentClassForColumn, type ConcordanceRow } from './concordanceTableModel';
import { CONCORDANCE_COLUMN_KEYS } from '../../common/generatedColumns';

interface Props {
  table: TanStackTable<ConcordanceRow>;
  rows: ConcordanceRow[];
  tableColumns: string[];
  searchWord: string;
  loading: boolean;
  renderHeader: (header: Header<ConcordanceRow, unknown>) => ReactNode;
  getRowClassName: (row: ConcordanceRow, index: number) => string;
  getRowStyle?: (row: ConcordanceRow, index: number) => CSSProperties | undefined;
  getSourceColor?: (row: ConcordanceRow) => string | undefined;
  highlightL1R1: boolean;
  onRowClick: (row: ConcordanceRow) => void;
}

/**
 * Returns direct-cell emphasis for Concordance sort anchors.
 * Used by: ConcordanceRowsTable in every table mode. Matched text always keeps
 * strong source-colour emphasis; the local display toggle controls only the
 * softer L1/R1 backgrounds and never parses tokens out of context strings.
 */
function concordanceCellPresentation(
  columnId: string,
  sourceColor: string | undefined,
  highlightL1R1: boolean,
): { className?: string; style?: CSSProperties } {
  const color = sourceColor ?? GREY;
  if (columnId === CONCORDANCE_COLUMN_KEYS.matchedText) {
    return {
      className: 'font-semibold',
      style: { backgroundColor: toBgColor(color, 0.24), color: '#111827' },
    };
  }
  if (
    highlightL1R1 &&
    (columnId === CONCORDANCE_COLUMN_KEYS.leftToken ||
      columnId === CONCORDANCE_COLUMN_KEYS.rightToken)
  ) {
    return {
      style: { backgroundColor: toBgColor(color, 0.12), color: '#111827' },
    };
  }
  return {};
}

/**
 * Renders the common KWIC concordance table markup for combined and per-node
 * table blocks.
 *
 * Used by: ConcordanceTableNodeBlock subcomponents because both branches share
 * empty-state wording, TanStack body rendering, KWIC cell alignment, and row
 * click wiring, while their header controls and row colour rules differ.
 */
export function ConcordanceRowsTable({
  table,
  rows,
  tableColumns,
  searchWord,
  loading,
  renderHeader,
  getRowClassName,
  getRowStyle,
  getSourceColor,
  highlightL1R1,
  onRowClick,
}: Props) {
  return (
    <Table className="min-w-180" disableContainer>
      <TableHeader className="bg-gray-50 sticky top-0 z-10">
        {table.getHeaderGroups().map((headerGroup) => (
          <TableRow key={headerGroup.id}>
            {headerGroup.headers.map((header) => renderHeader(header))}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {loading ? (
          <PaginatedTableProcessingRow columnCount={tableColumns.length} />
        ) : rows.length === 0 ? (
          <TableRow>
            <TableCell
              className="h-24 text-center text-muted-foreground"
              colSpan={tableColumns.length || 1}
            >
              No matching rows on this page for &quot;{searchWord}&quot;. Source rows without
              matches are omitted.
            </TableCell>
          </TableRow>
        ) : (
          table.getRowModel().rows.map((tableRow, index) => {
            const row = tableRow.original;
            return (
              <TableRow
                key={tableRow.id}
                className={getRowClassName(row, index)}
                style={getRowStyle?.(row, index)}
                onClick={() => {
                  onRowClick(row);
                }}
              >
                {tableRow.getVisibleCells().map((cell) => {
                  const presentation = concordanceCellPresentation(
                    cell.column.id,
                    getSourceColor?.(row),
                    highlightL1R1,
                  );
                  return (
                    <TableCell
                      key={cell.id}
                      className={`${alignmentClassForColumn(cell.column.id)} ${presentation.className ?? ''}`}
                      style={presentation.style}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  );
                })}
              </TableRow>
            );
          })
        )}
      </TableBody>
    </Table>
  );
}

/**
 * Plain non-sortable header used by the combined view.
 * Used by: CombinedConcordanceTable because only separated per-node tables
 * have backend sort controls.
 */
export function ConcordancePlainHeader({
  header,
  hint,
}: {
  header: Header<ConcordanceRow, unknown>;
  hint?: string;
}) {
  return (
    <TableHead
      key={header.id}
      className={`px-3 py-2 text-xs font-medium uppercase tracking-wider text-gray-500 ${alignmentClassForColumn(header.column.id) || 'text-left'}`}
    >
      <DisabledReasonTooltip reason={hint} side="bottom">
        <span>{header.column.id}</span>
      </DisabledReasonTooltip>
    </TableHead>
  );
}
