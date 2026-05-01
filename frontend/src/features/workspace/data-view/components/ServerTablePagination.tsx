import { useEffect, useId, useRef, useState } from 'react';
import type { Table } from '@tanstack/react-table';
import { MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/Pagination';

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

type PaginationRangeItem = number | 'dots';

const buildPaginationRange = (current: number, total: number): PaginationRangeItem[] => {
  const normalizedTotal = Math.max(total, 1);
  const output: PaginationRangeItem[] = [];
  let previous: number | null = null;

  for (let page = 1; page <= normalizedTotal; page++) {
    const isBoundary = page === 1 || page === normalizedTotal;
    const isNearCurrent = Math.abs(page - current) <= 1;
    const shouldShow = normalizedTotal <= 5 || isBoundary || isNearCurrent;

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
};

// ── Jump-to-page popover ─────────────────────────────────────────────
function PaginationJump({ totalPages, onPageChange }: { totalPages: number; onPageChange: (page: number) => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const inputId = useId();
  const errorId = `${inputId}-error`;

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

  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      setValue('');
      setError(null);
      inputRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) {
      setError(`Enter a whole number between 1 and ${totalPages}`);
      return;
    }
    const target = Number.parseInt(trimmed, 10);
    if (Number.isNaN(target) || target < 1 || target > totalPages) {
      setError(`Enter a value between 1 and ${totalPages}`);
      return;
    }
    onPageChange(target);
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((prev) => !prev)}
        className="size-8 text-muted-foreground hover:text-foreground"
      >
        <MoreHorizontal className="h-4 w-4" />
        <span className="sr-only">Jump to page</span>
      </Button>
      {open && (
        <div className="absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 rounded-md border border-border bg-popover px-3 py-2 text-popover-foreground shadow-lg">
          <form className="flex items-center gap-2" onSubmit={handleSubmit} noValidate>
            <Input
              id={inputId}
              ref={inputRef}
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                if (error) setError(null);
              }}
              type="text"
              inputMode="numeric"
              placeholder={`${totalPages}`}
              aria-invalid={error ? 'true' : undefined}
              aria-describedby={error ? errorId : undefined}
              className={cn('h-8 w-16 text-sm', error && 'border-destructive focus-visible:ring-destructive')}
            />
            <Button type="submit" size="sm">Go</Button>
            {error && <span id={errorId} className="sr-only">{error}</span>}
          </form>
        </div>
      )}
    </div>
  );
}

// ── Main pagination component ────────────────────────────────────────
interface ServerTablePaginationProps<TData> {
  table: Table<TData>;
  pageSizeOptions?: number[];
}

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

  const canPrev = table.getCanPreviousPage();
  const canNext = table.getCanNextPage();

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
                <PaginationJump totalPages={safeTotalPages} onPageChange={goToPage} />
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
