import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Input } from './ui/input';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from './ui/Pagination';
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
// Helpers
// ---------------------------------------------------------------------------

type PaginationRangeItem = number | 'dots';

/**
 * Build a compact list of page numbers (and ellipsis markers) to display.
 *
 * When `totalPages` is known the algorithm keeps boundary pages (first/last)
 * and a small window around the current page.  When the total is **not**
 * known we fall back to a simpler heuristic based on the current page and
 * the `hasNext` flag.
 */
const buildPaginationRange = (
  current: number,
  totalPages: number | undefined,
  hasNext: boolean,
): PaginationRangeItem[] => {
  // --- Known total ---------------------------------------------------------
  if (typeof totalPages === 'number' && totalPages > 0) {
    const total = Math.max(totalPages, 1);
    const output: PaginationRangeItem[] = [];
    let previous: number | null = null;

    for (let page = 1; page <= total; page++) {
      const isBoundary = page === 1 || page === total;
      const isNearCurrent = Math.abs(page - current) <= 1;
      const shouldShow = total <= 5 || isBoundary || isNearCurrent;

      if (!shouldShow) continue;

      if (previous !== null) {
        const gap = page - previous;
        if (gap === 2) {
          output.push(previous + 1);
        } else if (gap > 2) {
          output.push('dots');
        }
      }

      output.push(page);
      previous = page;
    }

    return output;
  }

  // --- Unknown total (concordance / quotation) -----------------------------
  // Show pages around current and an ellipsis at the end when more exist.
  const output: PaginationRangeItem[] = [];

  if (current <= 3) {
    for (let p = 1; p <= current; p++) output.push(p);
  } else {
    output.push(1);
    output.push('dots');
    output.push(current - 1);
    output.push(current);
  }

  if (hasNext) {
    output.push(current + 1);
    output.push('dots');
  }

  return output;
};

// ---------------------------------------------------------------------------
// PaginationJump – clickable "…" that becomes a page-number input
// ---------------------------------------------------------------------------

interface PaginationJumpProps {
  /** Known total pages (optional). Used for validation messages. */
  totalPages?: number;
  onPageChange: (page: number) => void;
}

const PaginationJump = ({ totalPages, onPageChange }: PaginationJumpProps) => {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const inputId = useId();
  const errorId = `${inputId}-error`;

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current || containerRef.current.contains(event.target as Node)) return;
      setOpen(false);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  // Reset & focus when opened
  useEffect(() => {
    if (!open) return;
    setValue('');
    setError(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmed = value.trim();
      if (!/^\d+$/.test(trimmed)) {
        setError(totalPages ? `Enter a number between 1 and ${totalPages}` : 'Enter a page number');
        return;
      }

      const target = Number.parseInt(trimmed, 10);
      if (Number.isNaN(target) || target < 1 || (totalPages && target > totalPages)) {
        setError(totalPages ? `Enter a value between 1 and ${totalPages}` : 'Enter a valid page number');
        return;
      }

      onPageChange(target);
      setOpen(false);
    },
    [onPageChange, totalPages, value],
  );

  return (
    <div ref={containerRef} className="relative">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((prev) => !prev)}
        className="size-9 text-muted-foreground hover:text-foreground"
      >
        <MoreHorizontal className="h-4 w-4" />
        <span className="sr-only">Jump to page</span>
      </Button>
      {open && (
        <div className="absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 rounded-md border border-border bg-popover px-3 py-2 text-popover-foreground shadow-lg">
          <form className="flex items-center gap-2" onSubmit={handleSubmit} noValidate>
            <label className="text-xs font-medium text-muted-foreground" htmlFor={inputId}>
              Page:
            </label>
            <Input
              id={inputId}
              ref={inputRef}
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                if (error) setError(null);
              }}
              type="text"
              inputMode="numeric"
              placeholder={totalPages ? `${totalPages}` : '…'}
              aria-invalid={error ? 'true' : undefined}
              aria-describedby={error ? errorId : undefined}
              className={cn(
                'h-8 w-16 text-sm',
                error && 'border-destructive focus-visible:ring-destructive',
              )}
            />
            <Button type="submit" size="sm">
              Go
            </Button>
            {error && (
              <span id={errorId} className="sr-only">
                {error}
              </span>
            )}
          </form>
        </div>
      )}
    </div>
  );
};

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
        'grid grid-cols-[auto_1fr_auto] items-center gap-3 border-t border-border bg-muted/40 px-4 py-3',
        className,
      )}
    >
      {/* Left: Rows per page */}
      <div className="flex items-center gap-2">
        {onPageSizeChange && (
          <>
            <Label htmlFor="analysis-rows-per-page" className="text-sm text-muted-foreground whitespace-nowrap">
              Rows per page
            </Label>
            <Select
              value={String(pageSize)}
              onValueChange={(val) => onPageSizeChange(Number(val))}
            >
              <SelectTrigger className="w-20 h-9" id="analysis-rows-per-page">
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
      </div>

      {/* Center: Pagination buttons */}
      <Pagination className="mx-auto w-auto">
        <PaginationContent>
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

      {/* Right: Extra controls (e.g. Detach) */}
      <div className="flex items-center justify-end gap-2">
        {children}
      </div>
    </div>
  );
};

export default AnalysisPagination;
