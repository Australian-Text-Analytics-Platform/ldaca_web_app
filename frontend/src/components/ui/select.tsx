import * as React from 'react';
import { Select as SelectPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';

/** Select root primitive used by settings, filters, and data-loader forms. */
const Select = SelectPrimitive.Root;

/** Select group primitive for logically grouping options. */
const SelectGroup = SelectPrimitive.Group;

/** Select value primitive used inside triggers to display the chosen option. */
const SelectValue = SelectPrimitive.Value;

type SelectTriggerProps = React.ComponentProps<typeof SelectPrimitive.Trigger>;

/** Trigger button wrapper used by app selects for consistent focus and chevron styling. */
const SelectTrigger = ({ className, children, ref, ...props }: SelectTriggerProps) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      'flex h-control w-full items-center justify-between whitespace-nowrap rounded-sm border border-input-border bg-[var(--vscode-dropdown-background)] px-1.5 py-1 text-body text-[var(--vscode-dropdown-foreground)] data-placeholder:text-description focus-visible:border-focus focus-visible:outline focus-visible:outline-1 focus-visible:outline-focus disabled:cursor-not-allowed disabled:text-disabled [&>span]:line-clamp-1',
      className,
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="h-4 w-4 opacity-50" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
);

/** Scroll-up affordance shown by long select option lists. */
const SelectScrollUpButton = ({
  className,
  ref,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    className={cn('flex cursor-default items-center justify-center py-1', className)}
    {...props}
  >
    <ChevronUp className="h-4 w-4" />
  </SelectPrimitive.ScrollUpButton>
);

/** Scroll-down affordance shown by long select option lists. */
const SelectScrollDownButton = ({
  className,
  ref,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    className={cn('flex cursor-default items-center justify-center py-1', className)}
    {...props}
  >
    <ChevronDown className="h-4 w-4" />
  </SelectPrimitive.ScrollDownButton>
);

type SelectContentProps = React.ComponentProps<typeof SelectPrimitive.Content>;

/** Portal-backed select content panel used by dropdown option lists. */
const SelectContent = ({
  className,
  children,
  position = 'popper',
  ref,
  ...props
}: SelectContentProps) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      className={cn(
        'relative z-50 max-h-(--radix-select-content-available-height) min-w-32 overflow-y-auto overflow-x-hidden rounded-md border border-[var(--vscode-widget-border)] bg-widget text-widget-foreground shadow-[var(--vscode-shadow-lg)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 origin-[--radix-select-content-transform-origin]',
        position === 'popper' &&
          'data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1',
        className,
      )}
      position={position}
      {...props}
    >
      <SelectScrollUpButton />
      <SelectPrimitive.Viewport
        className={cn(
          'p-1',
          position === 'popper' && 'w-full min-w-(--radix-select-trigger-width)',
        )}
      >
        {children}
      </SelectPrimitive.Viewport>
      <SelectScrollDownButton />
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
);

/** Select label row used to name grouped option sets. */
const SelectLabel = ({
  className,
  ref,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Label>) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn('px-2 py-1 text-label font-semibold', className)}
    {...props}
  />
);

type SelectItemProps = React.ComponentProps<typeof SelectPrimitive.Item>;

/**
 * Select option row with checkmark indicator for chosen values. The compact control height is a
 * minimum, not a fixed height, so two-line options (label plus identifier) grow instead of
 * overlapping the next row.
 */
const SelectItem = ({ className, children, ref, ...props }: SelectItemProps) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      'relative flex min-h-control-sm w-full cursor-default select-none items-center rounded-sm py-0.5 pl-2 pr-8 text-body outline-hidden focus:bg-list-hover focus:text-foreground data-[highlighted]:bg-list-hover data-[highlighted]:text-foreground data-disabled:pointer-events-none data-disabled:text-disabled',
      className,
    )}
    {...props}
  >
    <span className="absolute right-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
);

export { Select, SelectGroup, SelectValue, SelectTrigger, SelectContent, SelectLabel, SelectItem };
