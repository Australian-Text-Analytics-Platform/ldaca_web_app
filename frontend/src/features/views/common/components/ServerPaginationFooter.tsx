import { cn } from '@/lib/utils';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationJump,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/Pagination';
import { buildPaginationRange } from '@/components/ui/paginationRange';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';

/** Default page-size options shared by every server-backed paginated table. */
const DEFAULT_PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

interface PaginationTableActions {
  setPageIndex: (pageIndex: number) => void;
  setPageSize: (pageSize: number) => void;
}

export interface ServerPaginationFooterProps {
  /**
   * TanStack instance used ONLY for actions (setPageIndex / setPageSize). Its
   * reference is referentially stable across renders, so display state is taken
   * from the props below instead — otherwise React Compiler memoizes this
   * component on the unchanged `table` reference and the page indicator freezes
   * even as pagination advances.
   */
  table: PaginationTableActions;
  /** Zero-based current page index (real changing value from the consumer). */
  pageIndex: number;
  /** Current page size (real changing value from the consumer). */
  pageSize: number;
  /** Trustworthy total row count used to derive exact page bounds. */
  rowCount?: number;
  /** Cheap page lookahead used only when an exact total is unavailable. */
  hasNext?: boolean;
  /** Options shown in the page-size dropdown. */
  pageSizeOptions?: number[];
  /**
   * Whether to render the page-size selector. Hidden when the consumer is
   * read-only (page navigation stays available, page-size change does not).
   */
  showPageSize?: boolean;
  /** Context-specific label for the page-size selector. */
  pageSizeLabel?: React.ReactNode;
  /** Optional summary rendered after the page-size selector. */
  pageSizeSummary?: React.ReactNode;
  /** Show an inline loading indicator next to the page controls. */
  loading?: boolean;
  /** Trailing actions such as Add to Workspace buttons. */
  children?: React.ReactNode;
  /** Tight workspace styling (native select, smaller paddings). */
  compact?: boolean;
  /** Additional CSS class for the outer wrapper. */
  className?: string;
}

/**
 * Unified pagination footer for every server-backed TanStack table.
 *
 * Display state comes from the backend-controlled pagination props. The
 * narrowed `table` interface is used only to dispatch page actions through the
 * consumer's `onPaginationChange` bridge.
 *
 * For analysis tables (concordance, quotation) `rowCount` is the number of
 * SOURCE documents, not displayed hit rows — so the page count reflects
 * "documents per batch" pagination even though each page renders a different
 * number of hit rows.
 *
 * Exact totals render compact ranges whose ellipses open `PaginationJump`.
 * Lookahead-only transports render the same range with inert ellipses because
 * they cannot validate an arbitrary destination without counting the result.
 *
 * Rendered by: WorkspaceTable (compact), ConcordanceTableNodeBlock,
 * QuotationNodeBlock, ConcordanceDispersionNodeBlock, PreviewTable because
 * every on-demand paginated table needs one consistent
 * footer that mutates query state instead of slicing rows locally.
 * Flow: derive page bounds from the props, render the page-size selector, page
 * links and optional summary/loading/trailing actions, then emit changes back
 * through the table instance.
 */
export function ServerPaginationFooter({
  table,
  pageIndex,
  pageSize,
  rowCount,
  hasNext,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  showPageSize = true,
  pageSizeLabel = 'Rows per page',
  pageSizeSummary,
  loading = false,
  children,
  compact = false,
  className,
}: ServerPaginationFooterProps) {
  const totalPages =
    rowCount === undefined ? undefined : pageSize > 0 ? Math.ceil(rowCount / pageSize) : 0;
  const pageCount = totalPages ?? pageIndex + 1 + (hasNext ? 1 : 0);

  if (compact && totalPages === 0) return null;

  const currentPage = pageIndex + 1; // 0-indexed → 1-indexed for display
  const safeTotalPages = Math.max(pageCount, 1);
  const normalizedOptions = Array.from(new Set([...pageSizeOptions, pageSize])).sort(
    (a, b) => a - b,
  );
  const paginationRange = buildPaginationRange(
    currentPage,
    totalPages === undefined ? undefined : safeTotalPages,
    hasNext,
  );

  const canPrev = pageIndex > 0;
  const canNext = totalPages === undefined ? Boolean(hasNext) : pageIndex < pageCount - 1;

  /** Converts a display page number back into TanStack's zero-based page index. */
  const goToPage = (page: number) => {
    table.setPageIndex(page - 1);
  };

  if (compact) {
    return (
      <div
        className={cn(
          'flex flex-col gap-1.5 border-t border-surface-border bg-panel/40 px-3 py-1.5 sm:flex-row sm:items-center sm:justify-between',
          className,
        )}
      >
        {showPageSize ? (
          <div className="flex items-center gap-2 text-label-secondary text-description">
            <span>{pageSizeLabel}</span>
            <select
              value={pageSize}
              onChange={(e) => {
                table.setPageSize(Number(e.target.value));
              }}
              className="h-7 rounded-md border border-input-border bg-editor px-2 py-0.5 text-label-secondary text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-focus"
            >
              {normalizedOptions.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <span />
        )}

        <Pagination className="w-full justify-center sm:w-auto sm:justify-end">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  if (canPrev) table.setPageIndex(pageIndex - 1);
                }}
                className={cn(!canPrev && 'pointer-events-none opacity-50')}
                aria-disabled={!canPrev}
                tabIndex={!canPrev ? -1 : undefined}
              />
            </PaginationItem>
            {paginationRange.map((item, index) => (
              <PaginationItem key={`${String(item)}-${String(index)}`}>
                {item === 'dots' && totalPages !== undefined ? (
                  <PaginationJump
                    totalPages={safeTotalPages}
                    onPageChange={goToPage}
                    triggerClassName="size-8"
                    showPageLabel={false}
                  />
                ) : item === 'dots' ? (
                  <PaginationEllipsis className="size-8" />
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
                  if (canNext) table.setPageIndex(pageIndex + 1);
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

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-3 border-t border-surface-border bg-panel/40 px-4 py-3',
        className,
      )}
    >
      {/* Left: Page size selector */}
      <div className="flex flex-wrap items-center gap-2">
        {showPageSize && (
          <>
            <Label
              htmlFor="server-rows-per-page"
              className="whitespace-nowrap text-body text-description"
            >
              {pageSizeLabel}
            </Label>
            <Select
              value={String(pageSize)}
              onValueChange={(val) => {
                table.setPageSize(Number(val));
              }}
            >
              <SelectTrigger className="h-9 w-20" id="server-rows-per-page">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start">
                <SelectGroup>
                  {normalizedOptions.map((size) => (
                    <SelectItem key={size} value={String(size)}>
                      {size}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </>
        )}
        {pageSizeSummary ? (
          <span className="text-body text-description">{pageSizeSummary}</span>
        ) : null}
      </div>

      {/* Center: Pagination buttons */}
      <Pagination className="w-auto min-w-0 flex-1 basis-40">
        <PaginationContent className="flex-wrap">
          <PaginationItem>
            <PaginationPrevious
              href="#"
              onClick={(event) => {
                event.preventDefault();
                if (canPrev) table.setPageIndex(pageIndex - 1);
              }}
              className={cn(!canPrev && 'pointer-events-none opacity-50')}
              aria-disabled={!canPrev}
              tabIndex={!canPrev ? -1 : undefined}
            />
          </PaginationItem>

          {paginationRange.map((item, index) => (
            <PaginationItem key={`${String(item)}-${String(index)}`}>
              {item === 'dots' && totalPages !== undefined ? (
                <PaginationJump totalPages={safeTotalPages} onPageChange={goToPage} />
              ) : item === 'dots' ? (
                <PaginationEllipsis />
              ) : (
                <PaginationLink
                  href="#"
                  onClick={(event) => {
                    event.preventDefault();
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
              onClick={(event) => {
                event.preventDefault();
                if (canNext) table.setPageIndex(pageIndex + 1);
              }}
              className={cn(!canNext && 'pointer-events-none opacity-50')}
              aria-disabled={!canNext}
              tabIndex={!canNext ? -1 : undefined}
            />
          </PaginationItem>

          {loading && (
            <PaginationItem>
              <div className="ml-1 h-4 w-4 animate-spin rounded-full border-2 border-surface-border-foreground border-t-transparent" />
            </PaginationItem>
          )}
        </PaginationContent>
      </Pagination>

      {/* Right: Extra controls (e.g. Add to Workspace) */}
      {children ? <div className="flex items-center gap-2">{children}</div> : null}
    </div>
  );
}
