import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '../../../../components/ui/Pagination';
import type { PaginationInfo } from '../types';

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

    if (!shouldShow) {
      continue;
    }

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

interface PaginationJumpProps {
  totalPages: number;
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

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current || containerRef.current.contains(event.target as Node)) {
        return;
      }
      setOpen(false);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setValue('');
    setError(null);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, [open]);

  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmed = value.trim();
      const numericPattern = /^\d+$/;

      if (!numericPattern.test(trimmed)) {
        setError(`Enter a whole number between 1 and ${totalPages}`);
        return;
      }

      const targetPage = Number.parseInt(trimmed, 10);
      if (Number.isNaN(targetPage) || targetPage < 1 || targetPage > totalPages) {
        setError(`Enter a value between 1 and ${totalPages}`);
        return;
      }

      onPageChange(targetPage);
      setOpen(false);
    },
    [onPageChange, totalPages, value]
  );

  return (
    <div ref={containerRef} className="relative">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((previous) => !previous)}
        className="size-9 text-muted-foreground hover:text-foreground"
      >
        <MoreHorizontal className="h-4 w-4" />
        <span className="sr-only">Jump to page</span>
      </Button>
      {open ? (
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
                if (error) {
                  setError(null);
                }
              }}
              type="text"
              inputMode="numeric"
              placeholder={`${totalPages}`}
              aria-invalid={error ? 'true' : undefined}
              aria-describedby={error ? errorId : undefined}
              className={cn(
                'h-8 w-16 text-sm',
                error && 'border-destructive focus-visible:ring-destructive'
              )}
            />
            <Button type="submit" size="sm">
              Go
            </Button>
            {error ? (
              <span id={errorId} className="sr-only">
                {error}
              </span>
            ) : null}
          </form>
        </div>
      ) : null}
    </div>
  );
};

interface TablePaginationControlsProps {
  pagination?: PaginationInfo | null;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: number[];
}

export const TablePaginationControls = ({
  pagination,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
}: TablePaginationControlsProps) => {
  const controls = useMemo(() => {
    if (!pagination || !onPageChange || !onPageSizeChange) {
      return null;
    }

    const { page, page_size, total_pages, has_next, has_prev } = pagination;
    const safeTotalPages = Math.max(total_pages ?? 1, 1);
    const normalizedOptions = Array.from(new Set([...pageSizeOptions, page_size])).sort((a, b) => a - b);
    const paginationRange = buildPaginationRange(page, safeTotalPages);

    const prevDisabled = !has_prev;
    const nextDisabled = !has_next;

    return (
      <div className="flex flex-col gap-3 border-t border-border bg-muted/40 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>Rows per page</span>
          <select
            value={page_size}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            className="h-9 rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {normalizedOptions.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </div>

        <Pagination className="w-full justify-center sm:w-auto sm:justify-end">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                href="#"
                onClick={(event) => {
                  event.preventDefault();
                  if (!prevDisabled) {
                    onPageChange(page - 1);
                  }
                }}
                className={cn(prevDisabled && 'pointer-events-none opacity-50')}
                aria-disabled={prevDisabled}
                tabIndex={prevDisabled ? -1 : undefined}
              />
            </PaginationItem>
            {paginationRange.map((item, index) => (
              <PaginationItem key={`${item}-${index}`}>
                {item === 'dots' ? (
                  <PaginationJump totalPages={safeTotalPages} onPageChange={onPageChange} />
                ) : (
                  <PaginationLink
                    href="#"
                    onClick={(event) => {
                      event.preventDefault();
                      if (item !== page) {
                        onPageChange(item);
                      }
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
                  if (!nextDisabled) {
                    onPageChange(page + 1);
                  }
                }}
                className={cn(nextDisabled && 'pointer-events-none opacity-50')}
                aria-disabled={nextDisabled}
                tabIndex={nextDisabled ? -1 : undefined}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </div>
    );
  }, [pagination, onPageChange, onPageSizeChange, pageSizeOptions]);

  return controls;
};
