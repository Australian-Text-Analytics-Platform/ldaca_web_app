import * as React from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { createWildcardMatcher } from '@/lib/wildcardFilter';

export interface SearchableSelectOption {
  value: string;
  /** Display text; falls back to `value`. Both are matched when filtering. */
  label?: string;
}

export interface SearchableSelectProps {
  options: SearchableSelectOption[];
  value?: string;
  onChange: (value: string) => void;
  /**
   * Rows shown above the options — "None", "Create new…" and similar. They are
   * hidden while a query is active so they can never displace a genuine match,
   * and they are excluded from the trigger's selected-label lookup unless they
   * carry a label of their own.
   */
  pinnedOptions?: SearchableSelectOption[];
  /** Trigger text when nothing is selected. */
  placeholder?: React.ReactNode;
  /** Static content rendered inside the trigger, ahead of the selected value. */
  triggerPrefix?: React.ReactNode;
  searchPlaceholder?: string;
  emptyMessage?: React.ReactNode;
  disabled?: boolean;
  ariaLabel?: string;
  triggerClassName?: string;
  contentClassName?: string;
  /** Extra `data-*` attributes forwarded to the trigger button. */
  triggerData?: Record<string, string>;
}

/**
 * Single-select dropdown whose options are filtered by a type-in box supporting
 * substring and `*`/`?` wildcard queries.
 *
 * Used by: column pickers and other selects whose option list can run to
 * hundreds of entries, where scroll-and-click stops being workable.
 */
export function SearchableSelect({
  options,
  value,
  onChange,
  pinnedOptions,
  placeholder = 'Select…',
  triggerPrefix,
  searchPlaceholder = 'Type to filter… (* and ? wildcards)',
  emptyMessage = 'No matches',
  disabled,
  ariaLabel,
  triggerClassName,
  contentClassName,
  triggerData,
}: SearchableSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [activeIndex, setActiveIndex] = React.useState(0);
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const listboxId = `${React.useId()}-listbox`;

  const matcher = createWildcardMatcher(query);
  const matchedOptions = matcher
    ? options.filter(
        (option) => matcher(option.value) || (option.label !== undefined && matcher(option.label)),
      )
    : options;
  const pinnedRows = pinnedOptions ?? [];
  const rows: SearchableSelectOption[] = matcher ? matchedOptions : [...pinnedRows, ...options];

  // Clamped rather than synchronised, so a shrinking result list never leaves
  // the highlight pointing past the end.
  const activeRowIndex = rows.length === 0 ? -1 : Math.min(activeIndex, rows.length - 1);

  React.useEffect(() => {
    if (!open) return;
    const node = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    node?.scrollIntoView({ block: 'nearest' });
  }, [open, activeRowIndex]);

  const selectedOption = [...pinnedRows, ...options].find((option) => option.value === value);
  const triggerContent = selectedOption?.label ?? selectedOption?.value ?? (
    <span className="text-muted-foreground">{placeholder}</span>
  );

  /** Applies a row's value and returns the control to its resting state. */
  const commit = (next: string) => {
    onChange(next);
    setOpen(false);
    setQuery('');
    setActiveIndex(0);
  };

  /** Opens on a fresh query with the current value highlighted. */
  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) return;
    setQuery('');
    const selectedIndex = options.findIndex((option) => option.value === value);
    setActiveIndex(selectedIndex >= 0 ? pinnedRows.length + selectedIndex : 0);
  };

  /** Drives highlight movement and commit from the filter box. */
  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex(Math.min(activeRowIndex + 1, rows.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex(Math.max(activeRowIndex - 1, 0));
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActiveIndex(rows.length - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const row = rows[activeRowIndex];
      if (row) commit(row.value);
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls={open ? listboxId : undefined}
          aria-label={ariaLabel}
          disabled={disabled}
          // Enter and Space already open via the button's native click; the
          // arrow keys are the other half of the listbox idiom.
          onKeyDown={(event) => {
            if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
              event.preventDefault();
              handleOpenChange(true);
            }
          }}
          {...triggerData}
          className={cn(
            'flex h-9 w-full items-center justify-between gap-2 whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
            triggerClassName,
          )}
        >
          <span className="flex min-w-0 items-center">
            {triggerPrefix}
            <span className="truncate text-left">{triggerContent}</span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={cn('w-(--radix-popover-trigger-width) min-w-56 p-0', contentClassName)}
      >
        <div className="border-b p-2">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              autoFocus
              type="text"
              role="searchbox"
              aria-label="Filter options"
              aria-controls={listboxId}
              aria-activedescendant={
                activeRowIndex >= 0 ? `${listboxId}-${String(activeRowIndex)}` : undefined
              }
              value={query}
              placeholder={searchPlaceholder}
              className="h-8 pl-7 text-sm"
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={handleKeyDown}
            />
          </div>
          {matcher && (
            <p className="mt-1 px-0.5 text-[10px] text-muted-foreground">
              {String(matchedOptions.length)} of {String(options.length)} match
            </p>
          )}
        </div>
        <div
          ref={listRef}
          role="listbox"
          id={listboxId}
          aria-label={ariaLabel}
          className="max-h-64 overflow-y-auto p-1"
        >
          {rows.length === 0 ? (
            <div className="px-3 py-3 text-center text-xs text-muted-foreground">
              {emptyMessage}
            </div>
          ) : (
            rows.map((row, index) => {
              const isSelected = row.value === value;
              const isActive = index === activeRowIndex;
              return (
                <button
                  key={row.value}
                  type="button"
                  role="option"
                  id={`${listboxId}-${String(index)}`}
                  aria-selected={isSelected}
                  data-active={isActive ? 'true' : undefined}
                  className={cn(
                    'relative flex w-full items-center rounded-sm py-1.5 pl-2 pr-8 text-left text-sm',
                    isActive && 'bg-accent text-accent-foreground',
                  )}
                  onMouseMove={() => {
                    setActiveIndex(index);
                  }}
                  onClick={() => {
                    commit(row.value);
                  }}
                >
                  <span className="truncate">{row.label ?? row.value}</span>
                  {isSelected && <Check className="absolute right-2 h-4 w-4" aria-hidden="true" />}
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
