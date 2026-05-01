import React from 'react';
import { Loader2 } from 'lucide-react';
import { flexRender, type ColumnDef } from '@tanstack/react-table';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';
import { ScrollArea } from '../../../components/ui/scroll-area';
import { Button } from '../../../components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../../../components/ui/card';
import { RowDetailPanel } from '../../analysis/common/components/RowDetailPanel';
import { useRowDetailDialog } from '../../analysis/common/components/useRowDetailDialog';
import { useServerTable } from '../../../hooks/useServerTable';
import { formatPreviewValue } from '../utils/typeUtils';
import { type PreviewRow, type PreviewPagination, PREVIEW_PAGE_SIZE_OPTIONS } from '../types';

interface PreviewTableProps {
  title: React.ReactNode;
  description: string;
  columns: string[];
  data: PreviewRow[];
  pagination: PreviewPagination | null;
  loading: boolean;
  error: string | null;
  ready: boolean;
  readyMessage?: string;
  page: number;
  pageSize: number;
  onPageSizeChange: (size: number) => void;
  /** Set the current page (1-indexed). Replaces onPreviousPage / onNextPage. */
  onPageChange: (page: number) => void;
  loadingBadge?: React.ReactNode;
  documentColumn?: string;
}

function buildColumnDefs(columnsToRender: string[]): ColumnDef<PreviewRow, unknown>[] {
  return columnsToRender.map((col) => ({
    accessorKey: col,
    header: col,
    cell: ({ getValue }) => formatPreviewValue(getValue()),
  }));
}

/**
 * Shared preview table component used across data preprocessing sub-tabs.
 * Internally backed by a server-side TanStack Table (useServerTable) for
 * consistent rendering and pagination handling.
 */
export const PreviewTable: React.FC<PreviewTableProps> = ({
  title,
  description,
  columns,
  data,
  pagination,
  loading,
  error,
  ready,
  readyMessage = 'Configure conditions to see a preview',
  page,
  pageSize,
  onPageSizeChange,
  onPageChange,
  loadingBadge,
  documentColumn,
}) => {
  const { detailPayload, detailOpen, setDetailOpen, openDetail: openRowDetail } = useRowDetailDialog();
  const columnsToRender =
    columns.length > 0
      ? columns
      : data.length > 0 && typeof data[0] === 'object' && data[0] !== null
        ? Object.keys(data[0])
        : [];
  const tableColSpan = Math.max(columnsToRender.length, 1);
  const currentPage = pagination?.page ?? page;
  const displayTotalPages = pagination?.total_pages ?? Math.max(1, currentPage);

  const columnDefs = buildColumnDefs(columnsToRender);

  const table = useServerTable<PreviewRow>({
    data,
    columns: columnDefs,
    rowCount: pagination?.total_rows ?? data.length,
    pageIndex: currentPage - 1,
    pageSize,
    onPaginationChange: (next) => {
      if (next.pageSize !== pageSize) {
        onPageSizeChange(next.pageSize);
      }
      const newPage = next.pageIndex + 1;
      if (newPage !== currentPage) {
        onPageChange(newPage);
      }
    },
  });

  return (
    <Card>
      <CardHeader className="space-y-0 pb-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          {loadingBadge}
          {ready && !error && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <label htmlFor="preview-page-size" className="text-sm text-muted-foreground">
                Rows per page
              </label>
              <Select
                value={String(pageSize)}
                onValueChange={(value) => onPageSizeChange(Number(value))}
                disabled={loading}
              >
                <SelectTrigger className="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PREVIEW_PAGE_SIZE_OPTIONS.map((option) => (
                    <SelectItem key={option} value={String(option)}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        {!ready ? (
          <div className="rounded-md border border-dashed border-muted-foreground/40 bg-muted/40 p-4 text-sm text-muted-foreground">
            {readyMessage}
          </div>
        ) : error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        ) : (
          <ScrollArea type="always" scrollbars="horizontal" className="rounded-lg border border-border">
              <Table disableContainer>
                <TableHeader className="bg-muted/40">
                  {columnsToRender.length > 0 ? (
                    table.getHeaderGroups().map((headerGroup) => (
                      <TableRow key={headerGroup.id}>
                        {headerGroup.headers.map((header) => (
                          <TableHead
                            key={header.id}
                            className="px-3 py-2 text-left text-xs font-medium tracking-wide text-muted-foreground"
                          >
                            {header.isPlaceholder
                              ? null
                              : flexRender(header.column.columnDef.header, header.getContext())}
                          </TableHead>
                        ))}
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableHead className="px-3 py-2 text-left text-xs font-medium tracking-wide text-muted-foreground">
                        No columns
                      </TableHead>
                    </TableRow>
                  )}
                </TableHeader>
                <TableBody>
                  {loading && data.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={tableColSpan} className="px-3 py-6 text-center text-muted-foreground">
                        <span className="inline-flex items-center gap-2">
                          <Loader2 className="h-5 w-5 animate-spin text-primary" />
                          Loading preview…
                        </span>
                      </TableCell>
                    </TableRow>
                  ) : data.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={tableColSpan} className="px-3 py-6 text-center text-muted-foreground">
                        No rows match the current configuration.
                      </TableCell>
                    </TableRow>
                  ) : (
                    table.getRowModel().rows.map((row) => (
                      <TableRow
                        key={row.id}
                        className="cursor-pointer transition-colors duration-150 hover:bg-muted/40"
                        onClick={() => {
                          const original = row.original;
                          const detailTextColumn =
                            documentColumn && Object.prototype.hasOwnProperty.call(original, documentColumn)
                              ? documentColumn
                              : undefined;

                          openRowDetail({
                            record: Object.assign({}, original),
                            textColumn: detailTextColumn,
                          });
                        }}
                      >
                        {row.getVisibleCells().map((cell) => {
                          const cellValue = cell.getValue();
                          return (
                            <TableCell
                              key={cell.id}
                              className="max-w-xs truncate px-3 py-2 font-mono text-xs text-foreground"
                              title={String(cellValue ?? '')}
                            >
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
          </ScrollArea>
        )}
      </CardContent>
      {ready && !error && data.length > 0 && (
        <CardFooter className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/20 py-4">
          <div className="text-sm text-muted-foreground">
            {pagination
              ? `${pagination.total_rows} row${pagination.total_rows === 1 ? '' : 's'} · page ${currentPage} of ${displayTotalPages}`
              : 'Preview ready'}
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage() || loading}
              variant="outline"
              size="sm"
            >
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">Page {currentPage}</span>
            <Button
              type="button"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage() || loading}
              variant="outline"
              size="sm"
            >
              Next
            </Button>
          </div>
        </CardFooter>
      )}

      <RowDetailPanel
        open={detailOpen}
        onOpenChange={setDetailOpen}
        payload={detailPayload}
      />
    </Card>
  );
};
