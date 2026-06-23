import * as React from 'react';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  MoreHorizontal,
  MoreHorizontalIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Pagination navigation landmark used by table and analysis pagination controls.
 * Why: shared UI callers need a stable primitive boundary for layout, accessibility, and composition.
 */
function Pagination({ className, ...props }: React.ComponentProps<'nav'>) {
  return (
    <nav
      role="navigation"
      aria-label="pagination"
      data-slot="pagination"
      className={cn('mx-auto flex w-full justify-center', className)}
      {...props}
    />
  );
}

/** Used by: Pagination consumers to wrap page links, jump controls, and ellipses because the caller needs one documented boundary for the lookup, event, or state handoff step. */
function PaginationContent({ className, ...props }: React.ComponentProps<'ul'>) {
  return (
    <ul
      data-slot="pagination-content"
      className={cn('flex flex-row items-center gap-1', className)}
      {...props}
    />
  );
}

/** Used by: Pagination consumers for each page link or ellipsis item because the caller needs one documented boundary for the lookup, event, or state handoff step. */
function PaginationItem({ ...props }: React.ComponentProps<'li'>) {
  return <li data-slot="pagination-item" {...props} />;
}

type PaginationLinkProps = {
  isActive?: boolean;
} & Pick<React.ComponentProps<typeof Button>, 'size'> &
  Omit<React.ComponentProps<'a'>, 'size'>;

interface PaginationJumpProps {
  /** Known total pages. Omit for source-row pagination with unknown totals. */
  totalPages?: number;
  onPageChange: (page: number) => void;
  /** Override the trigger button's classes (e.g. `size-8` for tighter footers). */
  triggerClassName?: string;
  /** Whether to render a "Page:" label inside the popover. Defaults to true. */
  showPageLabel?: boolean;
}

/**
 * Clickable page-jump control used by pagination footers when page ranges are
 * compacted. It lets users enter an exact page while keeping unknown-total
 * server pagination supported.
 * Why: compact table pagers need an exact-page popover without assuming every backend can report total pages.
 * Flow: manage popover/input/error state, handle outside click and focus reset, validate page input, then call onPageChange and close.
 */
export function PaginationJump({
  totalPages,
  onPageChange,
  triggerClassName,
  showPageLabel = true,
}: PaginationJumpProps) {
  const [open, setOpen] = React.useState(false);
  const [value, setValue] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const inputId = React.useId();
  const errorId = `${inputId}-error`;

  React.useEffect(() => {
    if (!open) return;

    /**
     * Closes the page-size selector when consumers click outside the control.
     * Why: shared UI callers need a stable primitive boundary for layout, accessibility, and composition.
     */
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current || containerRef.current.contains(event.target as Node)) return;
      setOpen(false);
    };
    /** Called by: the PaginationJump document keydown listener because the interaction needs a single handler that validates state, runs the action, and updates feedback. */
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

  React.useEffect(() => {
    if (!open) return;
    // rAF defer avoids the react-hooks/set-state-in-effect lint while still
    // resetting the form and focusing the input the moment the popover opens.
    const id = requestAnimationFrame(() => {
      setValue('');
      setError(null);
      inputRef.current?.focus();
    });
    return () => {
      cancelAnimationFrame(id);
    };
  }, [open]);

  /**
   * Called by: the PaginationJump form onSubmit prop because the interaction needs a single handler that validates state, runs the action, and updates feedback.
   * Flow: trim and validate numeric input, report range errors, emit the parsed page to onPageChange, then close the popover.
   */
  const handleSubmit = (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) {
      setError(
        totalPages ? `Enter a number between 1 and ${String(totalPages)}` : 'Enter a page number',
      );
      return;
    }

    const target = Number.parseInt(trimmed, 10);
    if (Number.isNaN(target) || target < 1 || (totalPages && target > totalPages)) {
      setError(
        totalPages
          ? `Enter a value between 1 and ${String(totalPages)}`
          : 'Enter a valid page number',
      );
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
        onClick={() => {
          setOpen((prev) => !prev);
        }}
        className={cn('size-9 text-muted-foreground hover:text-foreground', triggerClassName)}
      >
        <MoreHorizontal className="h-4 w-4" />
        <span className="sr-only">Jump to page</span>
      </Button>
      {open && (
        <div className="absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 rounded-md border border-border bg-popover px-3 py-2 text-popover-foreground shadow-lg">
          <form className="flex items-center gap-2" onSubmit={handleSubmit} noValidate>
            {showPageLabel && (
              <label className="text-xs font-medium text-muted-foreground" htmlFor={inputId}>
                Page:
              </label>
            )}
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
              placeholder={totalPages ? String(totalPages) : '…'}
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
}

/** Used by: pagination footers for numeric pages and previous/next controls because the caller needs one documented boundary for the lookup, event, or state handoff step. */
function PaginationLink({ className, isActive, size = 'icon', ...props }: PaginationLinkProps) {
  return (
    <a
      aria-current={isActive ? 'page' : undefined}
      data-slot="pagination-link"
      data-active={isActive}
      className={cn(
        buttonVariants({
          variant: isActive ? 'outline' : 'ghost',
          size,
        }),
        className,
      )}
      {...props}
    />
  );
}

/**
 * Previous-page link wrapper used by paginated tables and analysis results.
 * Why: shared UI callers need a stable primitive boundary for layout, accessibility, and composition.
 */
function PaginationPrevious({ className, ...props }: React.ComponentProps<typeof PaginationLink>) {
  return (
    <PaginationLink
      aria-label="Go to previous page"
      size="default"
      className={cn('gap-1 px-2.5 sm:pl-2.5', className)}
      {...props}
    >
      <ChevronLeftIcon />
      <span className="hidden sm:block">Previous</span>
    </PaginationLink>
  );
}

/**
 * Next-page link wrapper used by paginated tables and analysis results.
 * Why: shared UI callers need a stable primitive boundary for layout, accessibility, and composition.
 */
function PaginationNext({ className, ...props }: React.ComponentProps<typeof PaginationLink>) {
  return (
    <PaginationLink
      aria-label="Go to next page"
      size="default"
      className={cn('gap-1 px-2.5 sm:pr-2.5', className)}
      {...props}
    >
      <span className="hidden sm:block">Next</span>
      <ChevronRightIcon />
    </PaginationLink>
  );
}

/** Used by: pagination footers when compact ranges hide intermediate pages because the caller needs one documented boundary for the lookup, event, or state handoff step. */
function PaginationEllipsis({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      aria-hidden
      data-slot="pagination-ellipsis"
      className={cn('flex size-9 items-center justify-center', className)}
      {...props}
    >
      <MoreHorizontalIcon className="size-4" />
      <span className="sr-only">More pages</span>
    </span>
  );
}

export {
  Pagination,
  PaginationContent,
  PaginationLink,
  PaginationItem,
  PaginationPrevious,
  PaginationNext,
  PaginationEllipsis,
  // buildPaginationRange and PaginationJump are exported inline above as
  // top-level `export const` so consumers can import them directly.
};
