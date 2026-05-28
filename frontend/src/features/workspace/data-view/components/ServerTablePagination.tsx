import type { Table } from '@tanstack/react-table';
import { cn } from '@/lib/utils';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationJump,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/Pagination';
import { buildPaginationRange } from '@/components/ui/paginationRange';

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

interface ServerTablePaginationProps<TData> {
  table: Table<TData>;
  pageSizeOptions?: number[];
}

/**
 * Renders TanStack server-pagination controls for WorkspaceTable.
 * Rendered by: paginationRange component, WorkspaceTable component (rg call sites/imports).
 * Why: because server-backed tables need pagination controls that update query state rather than slicing rows locally.
 * Flow: derive page bounds from TanStack state, render navigation buttons, then emit page-size changes through the table instance.
 */
export function ServerTablePagination<TData>({
  table,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
}: ServerTablePaginationProps<TData>) {
  const { pageIndex, pageSize } = table.getState().pagination;
  const pageCount = table.getPageCount();

  if (pageCount <= 0 && table.getRowCount() <= 0) return null;

  const currentPage = pageIndex + 1; // 0-indexed → 1-indexed for display
  const safeTotalPages = Math.max(pageCount, 1);
  const normalizedOptions = Array.from(new Set([...pageSizeOptions, pageSize])).sort((a, b) => a - b);
  const paginationRange = buildPaginationRange(currentPage, safeTotalPages);
  // ServerTablePagination's footer uses a tighter `py-1.5` row, so override
  // the default size-9 jump trigger to size-8 to keep visual proportions.

  const canPrev = table.getCanPreviousPage();
  const canNext = table.getCanNextPage();

    /**
   * Converts display page numbers back into TanStack's zero-based page index.
     * Called by: ServerTablePagination internal event, effect, or helper flow.
     * Why: because server-backed tables need pagination controls that update query state rather than slicing rows locally.
     */
  const goToPage = (page: number) => {
    table.setPageIndex(page - 1); // 1-indexed → 0-indexed
  };

  return (
    <div className="flex flex-col gap-1.5 border-t border-border bg-muted/40 px-3 py-1.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>Rows per page</span>
        <select
          value={pageSize}
          onChange={(e) => table.setPageSize(Number(e.target.value))}
          className="h-7 rounded-md border border-input bg-background px-2 py-0.5 text-xs text-foreground shadow-sm focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
        >
          {normalizedOptions.map((size) => (
            <option key={size} value={size}>{size}</option>
          ))}
        </select>
      </div>

      <Pagination className="w-full justify-center sm:w-auto sm:justify-end">
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious
              href="#"
              onClick={(e) => {
                e.preventDefault();
                if (canPrev) table.previousPage();
              }}
              className={cn(!canPrev && 'pointer-events-none opacity-50')}
              aria-disabled={!canPrev}
              tabIndex={!canPrev ? -1 : undefined}
            />
          </PaginationItem>
          {paginationRange.map((item, index) => (
            <PaginationItem key={`${item}-${index}`}>
              {item === 'dots' ? (
                <PaginationJump
                  totalPages={safeTotalPages}
                  onPageChange={goToPage}
                  triggerClassName="size-8"
                  showPageLabel={false}
                />
              ) : (
                <PaginationLink
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    if (item !== currentPage) goToPage(item);
                  }}
                  isActive={item === currentPage}
                  size="default"
                >
                  {item}
                </PaginationLink>
              )}
            </PaginationItem>
          ))}
          <PaginationItem>
            <PaginationNext
              href="#"
              onClick={(e) => {
                e.preventDefault();
                if (canNext) table.nextPage();
              }}
              className={cn(!canNext && 'pointer-events-none opacity-50')}
              aria-disabled={!canNext}
              tabIndex={!canNext ? -1 : undefined}
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  );
}
