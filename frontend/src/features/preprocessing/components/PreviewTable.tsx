import React from 'react';
import { Loader2 } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';
import { ScrollArea } from '../../../components/ui/scroll-area';
import { Button } from '../../../components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../../../components/ui/card';
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
  onPreviousPage: () => void;
  onNextPage: () => void;
  loadingBadge?: React.ReactNode;
}

/**
 * Shared preview table component used across data preprocessing sub-tabs
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
  onPreviousPage,
  onNextPage,
  loadingBadge,
}) => {
  const columnsToRender =
    columns.length > 0
      ? columns
      : data.length > 0 && typeof data[0] === 'object' && data[0] !== null
        ? Object.keys(data[0])
        : [];
  const tableColSpan = Math.max(columnsToRender.length, 1);
  const currentPage = pagination?.page ?? page;
  const displayTotalPages = pagination?.total_pages ?? Math.max(1, currentPage);

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
                  <TableRow>
                    {columnsToRender.length > 0 ? (
                      columnsToRender.map((col) => (
                        <TableHead
                          key={col}
                          className="px-3 py-2 text-left text-xs font-medium tracking-wide text-muted-foreground"
                        >
                          {col}
                        </TableHead>
                      ))
                    ) : (
                      <TableHead className="px-3 py-2 text-left text-xs font-medium tracking-wide text-muted-foreground">
                        No columns
                      </TableHead>
                    )}
                  </TableRow>
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
                    data.map((row, rowIndex) => (
                      <TableRow key={rowIndex}>
                        {columnsToRender.map((col) => {
                          const cellValue = formatPreviewValue(row[col]);
                          return (
                            <TableCell
                              key={`${rowIndex}-${col}`}
                              className="max-w-xs truncate px-3 py-2 font-mono text-xs text-foreground"
                              title={String(cellValue ?? '')}
                            >
                              {cellValue}
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
              onClick={onPreviousPage}
              disabled={!pagination?.has_prev || loading}
              variant="outline"
              size="sm"
            >
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">Page {currentPage}</span>
            <Button
              type="button"
              onClick={onNextPage}
              disabled={!pagination?.has_next || loading}
              variant="outline"
              size="sm"
            >
              Next
            </Button>
          </div>
        </CardFooter>
      )}
    </Card>
  );
};
