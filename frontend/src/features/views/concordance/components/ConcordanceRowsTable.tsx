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
import { alignmentClassForColumn, type ConcordanceRow } from './concordanceTableModel';

interface Props {
  table: TanStackTable<ConcordanceRow>;
  rows: ConcordanceRow[];
  tableColumns: string[];
  searchWord: string;
  loading: boolean;
  renderHeader: (header: Header<ConcordanceRow, unknown>) => ReactNode;
  getRowClassName: (row: ConcordanceRow, index: number) => string;
  getRowStyle?: (row: ConcordanceRow, index: number) => CSSProperties | undefined;
  onRowClick: (row: ConcordanceRow) => void;
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
                {tableRow.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} className={alignmentClassForColumn(cell.column.id)}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
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
export function ConcordancePlainHeader({ header }: { header: Header<ConcordanceRow, unknown> }) {
  return (
    <TableHead
      key={header.id}
      className={`px-3 py-2 text-xs font-medium uppercase tracking-wider text-gray-500 ${alignmentClassForColumn(header.column.id) || 'text-left'}`}
    >
      {header.column.id}
    </TableHead>
  );
}
