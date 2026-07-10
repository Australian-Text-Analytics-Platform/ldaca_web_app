import type { ColumnDef } from '@tanstack/react-table';
import { flexRender } from '@tanstack/react-table';
import { ArrowUpDown } from 'lucide-react';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { AnalysisTableFrame } from '@/features/views/common/components/AnalysisTableScrollArea';
import { ServerPaginationFooter } from '@/features/views/common/components/ServerPaginationFooter';
import { useServerTable } from '@/features/views/common/hooks/useServerTable';
import type { SourceRowPagination } from '@/api';
import { QUOTATION_DOCUMENT_COLUMN } from '../../common/generatedColumns';
import type { QuotationResultRow } from '../quotationResultsModel';
import { QuotationHighlightedCell, type QuotationHoverState } from './QuotationHighlightedCell';

export interface QuotationNodeBlockProps {
  /** Identifier for the node whose quotation results are shown. */
  nodeId: string;
  /** Text column whose document text carries the highlighted quotations. */
  textCol: string;
  /** Ordered display columns (document column first, then metadata). */
  cols: string[];
  /** Quotation rows for the current page (rows without quotations already filtered out). */
  rows: QuotationResultRow[];
  /** Source-row pagination metadata returned by the backend. */
  pagination?: SourceRowPagination | null;
  /** Currently active sort column, if any. */
  sortBy?: string | null;
  /** Words of surrounding context to keep when clipping highlighted cells. */
  contextLength: number;
  /** Shared hover state so only one highlight span lights up at a time. */
  hoverState: QuotationHoverState | null;
  /** Updates the shared hover state. */
  onHoverChange: (state: QuotationHoverState | null) => void;
  /** Toggles backend sorting for a column. */
  onSort: (nodeId: string, column: string) => void;
  /** Requests a different source-document page. */
  onPageChange: (page: number) => void;
  /** Requests a different documents-per-batch size. */
  onPageSizeChange: (pageSize: number) => void;
  /** Opens the row detail panel for a clicked row. */
  onRowClick: (row: QuotationResultRow) => void;
  /** Documents-per-batch options for the footer selector. */
  pageSizeOptions: number[];
  /** Summary rendered beside the page-size selector. */
  pageSizeSummary?: React.ReactNode;
  /** Hide the page-size selector when the view is read-only. */
  showPageSize?: boolean;
  /** Trailing footer actions (e.g. Process All / Add to Workspace). */
  children?: React.ReactNode;
}

/**
 * Renders one node's quotation results as a server-paginated TanStack table.
 *
 * Quotation pagination walks SOURCE documents, not displayed rows: each source
 * document yields zero or more quotation hits and empty documents are dropped,
 * so the rendered row count differs from the page size. The TanStack instance is
 * told `rowCount = total_source_rows` and `pageSize = page_size`, so its page
 * math reflects "documents per batch" while the body still shows the variable
 * number of hit rows.
 *
 * Rendered by: QuotationFeature for each selected node because the per-node hook
 * (`useServerTable`) cannot run inside the feature's node map, so each node owns
 * a child component with its own table instance.
 * Flow: build column defs that wrap the highlighted cell, bridge TanStack
 * pagination back to the feature's page handlers, then render header/body via
 * flexRender and the shared pagination footer.
 */
export function QuotationNodeBlock({
  nodeId,
  textCol,
  cols,
  rows,
  pagination,
  sortBy,
  contextLength,
  hoverState,
  onHoverChange,
  onSort,
  onPageChange,
  onPageSizeChange,
  onRowClick,
  pageSizeOptions,
  pageSizeSummary,
  showPageSize = true,
  children,
}: QuotationNodeBlockProps) {
  const page = pagination?.page ?? 1;
  const pageSize = pagination?.page_size ?? 50;
  const rowCount = pagination?.total_source_rows ?? 0;

  const columns: ColumnDef<QuotationResultRow>[] = cols.map((columnName) => ({
    id: columnName,
    accessorFn: (row) =>
      columnName === QUOTATION_DOCUMENT_COLUMN ? row.text : row.raw[columnName],
    header: () => {
      const active = sortBy === columnName;
      return (
        <button
          type="button"
          className="flex items-center gap-1.5 select-none"
          onClick={() => {
            onSort(nodeId, columnName);
          }}
        >
          <span>{columnName}</span>
          <ArrowUpDown className={`h-3 w-3 ${active ? 'text-foreground' : 'opacity-60'}`} />
        </button>
      );
    },
    cell: ({ row }) => {
      const data = row.original;
      if (Boolean(textCol) && columnName === QUOTATION_DOCUMENT_COLUMN) {
        return (
          <QuotationHighlightedCell
            row={data}
            cellKey={`${nodeId}:${row.id}:${columnName}`}
            contextLength={contextLength}
            hoverState={hoverState}
            onHoverChange={onHoverChange}
          />
        );
      }
      return data.cellText(columnName);
    },
  }));

  const table = useServerTable<QuotationResultRow>({
    data: rows,
    columns,
    rowCount,
    pageIndex: page - 1,
    pageSize,
    // Bridges TanStack's zero-based paging to the feature's one-based source-row handlers.
    // Invoked by useServerTable when quotation pagination changes.
    onPaginationChange: (next) => {
      if (next.pageSize !== pageSize) {
        onPageSizeChange(next.pageSize);
        return;
      }
      const newPage = next.pageIndex + 1;
      if (newPage !== page) {
        onPageChange(newPage);
      }
    },
  });

  return (
    <section className="space-y-4">
      <div className="border-b border-border/60 pb-4">
        <p className="text-sm text-muted-foreground">
          Text column: {textCol || 'Select a text column to view highlighted quotations.'}
        </p>
      </div>

      <AnalysisTableFrame
        maxHeightClass="max-h-[70vh]"
        contentClassName="min-w-max h-full"
        belowTable={
          <ServerPaginationFooter
            table={table}
            pageIndex={page - 1}
            pageSize={pageSize}
            rowCount={rowCount}
            pageSizeLabel="Documents per batch"
            pageSizeOptions={pageSizeOptions}
            pageSizeSummary={pageSizeSummary}
            showPageSize={showPageSize}
          >
            {children}
          </ServerPaginationFooter>
        }
      >
        <Table className="min-w-full text-sm" disableContainer>
          <TableHeader className="bg-muted sticky top-0 z-10">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="border-b border-border/60">
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className="h-10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground/90 select-none whitespace-nowrap cursor-pointer"
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  className="h-24 text-center text-muted-foreground"
                  colSpan={cols.length || 1}
                >
                  No quotations found on this page. Source rows without quotations are omitted.
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="border-b border-border/60 last:border-b-0 hover:bg-muted/40 cursor-pointer"
                  onClick={() => {
                    onRowClick(row.original);
                  }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className="px-4 py-3 align-top text-sm leading-relaxed"
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </AnalysisTableFrame>
    </section>
  );
}
