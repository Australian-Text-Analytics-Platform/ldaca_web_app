import { cn } from '../lib/utils';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationJump,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from './ui/Pagination';
import { buildPaginationRange } from './ui/paginationRange';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { Label } from './ui/label';

// ---------------------------------------------------------------------------
// AnalysisPagination – main exported component
// ---------------------------------------------------------------------------

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

export interface AnalysisPaginationProps {
  /** Current 1-based page number. */
  page: number;
  /** Current page size. */
  pageSize: number;
  /** Whether there is a next page. */
  hasNext: boolean;
  /** Whether there is a previous page. */
  hasPrev: boolean;
  /** Total number of pages (when known). */
  totalPages?: number;
  /** Called when the user navigates to a different page. */
  onPageChange: (page: number) => void;
  /** Called when the user changes the page size. Pass `undefined` to hide the selector. */
  onPageSizeChange?: (pageSize: number) => void;
  /** Context-specific label for the page-size selector. */
  pageSizeLabel?: React.ReactNode;
  /** Optional summary rendered after the page-size selector. */
  pageSizeSummary?: React.ReactNode;
  /** Options shown in the page-size dropdown. */
  pageSizeOptions?: number[];
  /** Show a loading indicator. */
  loading?: boolean;
  /** Extra content rendered on the trailing side (e.g. a Detach button). */
  children?: React.ReactNode;
  /** Additional CSS class for the outer wrapper. */
  className?: string;
}

export const AnalysisPagination = ({
  page,
  pageSize,
  hasNext,
  hasPrev,
  totalPages,
  onPageChange,
  onPageSizeChange,
  pageSizeLabel = 'Rows per page',
  pageSizeSummary,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  loading = false,
  children,
  className,
}: AnalysisPaginationProps) => {
  const normalizedOptions = Array.from(new Set([...pageSizeOptions, pageSize])).sort(
    (a, b) => a - b,
  );
  const paginationRange = buildPaginationRange(page, totalPages, hasNext);

  const prevDisabled = !hasPrev;
  const nextDisabled = !hasNext;

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-3 border-t border-border bg-muted/40 px-4 py-3',
        className,
      )}
    >
      {/* Left: Page size selector */}
      <div className="flex flex-wrap items-center gap-2">
        {onPageSizeChange && (
          <>
            <Label htmlFor="analysis-rows-per-page" className="whitespace-nowrap text-sm text-muted-foreground">
              {pageSizeLabel}
            </Label>
            <Select
              value={String(pageSize)}
              onValueChange={(val) => onPageSizeChange(Number(val))}
            >
              <SelectTrigger className="h-9 w-20" id="analysis-rows-per-page">
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
          <span className="text-sm text-muted-foreground">{pageSizeSummary}</span>
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
                if (!prevDisabled) onPageChange(page - 1);
              }}
              className={cn(prevDisabled && 'pointer-events-none opacity-50')}
              aria-disabled={prevDisabled}
              tabIndex={prevDisabled ? -1 : undefined}
            />
          </PaginationItem>

          {paginationRange.map((item, index) => (
            <PaginationItem key={`${item}-${index}`}>
              {item === 'dots' ? (
                <PaginationJump
                  totalPages={totalPages}
                  onPageChange={onPageChange}
                />
              ) : (
                <PaginationLink
                  href="#"
                  onClick={(event) => {
                    event.preventDefault();
                    if (item !== page) onPageChange(item);
                  }}
                  isActive={item === page}
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
                if (!nextDisabled) onPageChange(page + 1);
              }}
              className={cn(nextDisabled && 'pointer-events-none opacity-50')}
              aria-disabled={nextDisabled}
              tabIndex={nextDisabled ? -1 : undefined}
            />
          </PaginationItem>

          {loading && (
            <PaginationItem>
              <div className="ml-1 h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
            </PaginationItem>
          )}
        </PaginationContent>
      </Pagination>

      {/* Right: Extra controls (e.g. Add to Workspace) */}
      {children ? (
        <div className="flex items-center gap-2">
          {children}
        </div>
      ) : null}
    </div>
  );
};

export default AnalysisPagination;
