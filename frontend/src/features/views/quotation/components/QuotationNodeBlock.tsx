import { useEffect, useRef } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { flexRender } from '@tanstack/react-table';
import { ArrowUpDown } from 'lucide-react';
import type { SourceRowPagination } from '@/api';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { AnalysisTableFrame } from '@/features/views/common/components/AnalysisTableScrollArea';
import { PaginatedTableProcessingRow } from '@/features/views/common/components/PaginatedTableProcessingRow';
import { ServerPaginationFooter } from '@/features/views/common/components/ServerPaginationFooter';
import { useServerTable } from '@/features/views/common/hooks/useServerTable';
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
  /** Source metadata columns accepted by the snapshot sort contract. */
  sortableColumns: string[];
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
  /** Requests a different server page size. */
  onPageSizeChange: (pageSize: number) => void;
  /** Opens the row detail panel for a clicked row. */
  onRowClick: (row: QuotationResultRow) => void;
  /** Page-size options for the footer selector. */
  pageSizeOptions: number[];
  /** Summary rendered beside the page-size selector. */
  pageSizeSummary?: React.ReactNode;
  /** Whether the requested preview page is still processing. */
  loading: boolean;
  pageSizeLabel?: string;
  showPageSummary?: boolean;
  /** Whether the virtual document cell renders quotation highlights. */
  highlightDocument?: boolean;
  /** Hide the page-size selector when the view is read-only. */
  showPageSize?: boolean;
  /** Trailing footer actions such as Add to Workspace. */
  children?: React.ReactNode;
}

/**
 * Renders one node's quotation results as a server-paginated TanStack table.
 *
 * Preview and document Review pages contain grouped source documents. Match
 * Review pages contain one extract per group. The TanStack instance uses the
 * backend projection's explicit row count and page size for either unit.
 *
 * Rendered by: QuotationFeature for each selected node because the per-node hook
 * (`useServerTable`) cannot run inside the feature's node map, so each node owns
 * a child component with its own table instance.
 * Flow: build column defs that wrap the highlighted cell, bridge TanStack
 * pagination back to the feature's page handlers, then render header/body via
 * flexRender and the shared pagination footer.
 */
export function QuotationNodeBlock({ ...props }: QuotationNodeBlockProps) {
  // TanStack retains column-definition closures by column ID. Re-key when the
  // source column hydrates or changes so the virtual document header always
  // targets the current immutable Analysis column.
  return <QuotationNodeBlockContent key={props.textCol} {...props} />;
}

function QuotationNodeBlockContent({
  nodeId,
  textCol,
  cols,
  sortableColumns,
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
  loading,
  pageSizeLabel = 'Documents per page',
  showPageSummary = true,
  highlightDocument = true,
  showPageSize = true,
  children,
}: QuotationNodeBlockProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const page = pagination?.page ?? 1;
  const pageSize = pagination?.page_size ?? 50;
  const rowCount = pagination?.total_source_rows ?? 0;
  const sortableColumnSet = new Set(sortableColumns);

  useEffect(() => {
    if (viewportRef.current) viewportRef.current.scrollTop = 0;
  }, [pageSize]);

  const columns: ColumnDef<QuotationResultRow>[] = cols.map((columnName) => ({
    id: columnName,
    accessorFn: (row) =>
      columnName === QUOTATION_DOCUMENT_COLUMN ? row.text : row.raw[columnName],
    header: () => {
      const sourceSortColumn = columnName === QUOTATION_DOCUMENT_COLUMN ? textCol : columnName;
      const sortable =
        Boolean(sourceSortColumn) &&
        (columnName === QUOTATION_DOCUMENT_COLUMN || sortableColumnSet.has(columnName));
      if (!sortable) return <span>{columnName}</span>;
      const active = sortBy === sourceSortColumn;
      return (
        <button
          type="button"
          className="flex items-center gap-1.5 select-none"
          onClick={() => {
            onSort(nodeId, sourceSortColumn);
          }}
        >
          <span>{columnName}</span>
          <ArrowUpDown className={`h-3 w-3 ${active ? 'text-foreground' : 'opacity-60'}`} />
        </button>
      );
    },
    cell: ({ row }) => {
      const data = row.original;
      if (Boolean(textCol) && columnName === QUOTATION_DOCUMENT_COLUMN && highlightDocument) {
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
      if (columnName === QUOTATION_DOCUMENT_COLUMN) return data.text;
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
        if (viewportRef.current) viewportRef.current.scrollTop = 0;
        onPageSizeChange(next.pageSize);
        return;
      }
      const newPage = next.pageIndex + 1;
      if (newPage !== page) {
        if (viewportRef.current) viewportRef.current.scrollTop = 0;
        onPageChange(newPage);
      }
    },
  });

  return (
    <section className="space-y-4">
      <div className="border-b border-surface-border/60 pb-4">
        <p className="text-body text-description">
          Text column: {textCol || 'Select a text column to view highlighted quotations.'}
        </p>
      </div>

      <AnalysisTableFrame
        maxHeightClass="max-h-[70vh]"
        contentClassName="min-w-max h-full"
        viewportRef={viewportRef}
        belowTable={
          <ServerPaginationFooter
            table={table}
            pageIndex={page - 1}
            pageSize={pageSize}
            rowCount={rowCount}
            pageSizeLabel={pageSizeLabel}
            pageSizeOptions={pageSizeOptions}
            pageSizeSummary={showPageSummary ? pageSizeSummary : undefined}
            loading={loading}
            showPageSize={showPageSize}
          >
            {children}
          </ServerPaginationFooter>
        }
      >
        <Table className="min-w-full text-body" disableContainer>
          <TableHeader className="bg-panel sticky top-0 z-10">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="border-b border-surface-border/60">
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className="h-10 px-4 py-2 text-label-secondary font-semibold uppercase tracking-wide text-description/90 select-none whitespace-nowrap cursor-pointer"
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
            {loading ? (
              <PaginatedTableProcessingRow columnCount={cols.length} />
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell className="h-24 text-center text-description" colSpan={cols.length || 1}>
                  No quotations found on this page. Source rows without quotations are omitted.
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="border-b border-surface-border/60 last:border-b-0 hover:bg-panel/40 cursor-pointer"
                  onClick={() => {
                    onRowClick(row.original);
                  }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className="px-4 py-3 align-top text-body leading-relaxed"
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
