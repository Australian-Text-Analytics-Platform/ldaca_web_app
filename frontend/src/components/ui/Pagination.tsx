import * as React from 'react';
import { ChevronLeftIcon, ChevronRightIcon, MoreHorizontal } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Pagination navigation landmark used by table and analysis pagination controls.
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

/** Used by: Pagination consumers to wrap page links, jump controls, and ellipses. */
function PaginationContent({ className, ...props }: React.ComponentProps<'ul'>) {
  return (
    <ul
      data-slot="pagination-content"
      className={cn('flex flex-row items-center gap-1', className)}
      {...props}
    />
  );
}

/** Used by: Pagination consumers for each page link or ellipsis item. */
function PaginationItem({ ...props }: React.ComponentProps<'li'>) {
  return <li data-slot="pagination-item" {...props} />;
}

type PaginationLinkProps = {
  isActive?: boolean;
} & Pick<React.ComponentProps<typeof Button>, 'size'> &
  Omit<React.ComponentProps<'a'>, 'size'>;

interface PaginationJumpProps {
  /** Known total pages used to validate the destination. */
  totalPages: number;
  onPageChange: (page: number) => void;
  /** Override the trigger button's classes (e.g. `size-8` for tighter footers). */
  triggerClassName?: string;
  /** Whether to render a "Page:" label inside the popover. Defaults to true. */
  showPageLabel?: boolean;
}

/**
 * Clickable page-jump control used by pagination footers when page ranges are
 * compacted. It is intentionally available only when an exact total lets the
 * caller validate the destination.
 * Why: compact known-total table pagers need an exact-page popover, while
 * lookahead-only pagers must keep their ellipsis non-interactive.
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
     */
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current || containerRef.current.contains(event.target as Node)) return;
      setOpen(false);
    };
    /** Called by: the PaginationJump document keydown listener. */
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
    // Defer focus until the input has mounted with the open popover.
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => {
      cancelAnimationFrame(id);
    };
  }, [open]);

  /**
   * Called by: the PaginationJump form onSubmit prop.
   * Flow: trim and validate numeric input, report range errors, emit the parsed page to onPageChange, then close the popover.
   */
  const handleSubmit = (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) {
      setError(`Enter a number between 1 and ${String(totalPages)}`);
      return;
    }

    const target = Number.parseInt(trimmed, 10);
    if (Number.isNaN(target) || target < 1 || target > totalPages) {
      setError(`Enter a value between 1 and ${String(totalPages)}`);
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
          if (open) {
            setOpen(false);
            return;
          }
          setValue('');
          setError(null);
          setOpen(true);
        }}
        className={cn('size-9 text-description hover:text-foreground', triggerClassName)}
      >
        <MoreHorizontal className="h-4 w-4" />
        <span className="sr-only">Jump to page</span>
      </Button>
      {open && (
        <div className="absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 rounded-md border border-surface-border bg-widget px-3 py-2 text-widget-foreground">
          <form className="flex items-center gap-2" onSubmit={handleSubmit} noValidate>
            {showPageLabel && (
              <label
                className="text-label-secondary font-medium text-description"
                htmlFor={inputId}
              >
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
              placeholder={String(totalPages)}
              aria-invalid={error ? 'true' : undefined}
              aria-describedby={error ? errorId : undefined}
              className={cn('h-8 w-16 text-body', error && 'border-error focus-visible:ring-error')}
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

/** Used by: pagination footers for numeric pages and previous/next controls. */
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

/**
 * Displays an inert compact-range marker when no exact page bound is known.
 * Used by: ServerPaginationFooter for lookahead-only pagination, where an
 * arbitrary jump cannot be validated without counting or materializing rows.
 */
function PaginationEllipsis({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      aria-hidden
      data-slot="pagination-ellipsis"
      className={cn('flex size-9 items-center justify-center', className)}
      {...props}
    >
      <MoreHorizontal className="size-4" />
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
