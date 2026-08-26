'use client';

import * as React from 'react';
import { DropdownMenu as DropdownMenuPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';

/** Dropdown root primitive used by menus in sidebar and feature actions. */
const DropdownMenu = DropdownMenuPrimitive.Root;

/** Dropdown trigger primitive for menu buttons and icon affordances. */
const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

/** Radio-group primitive for menus with mutually exclusive choices. */
const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

/** Main dropdown content panel used by sidebar and toolbar menus. */
const DropdownMenuContent = ({
  className,
  sideOffset = 4,
  ref,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-50 max-h-(--radix-dropdown-menu-content-available-height) min-w-32 overflow-y-auto overflow-x-hidden rounded-md border border-[var(--vscode-menu-border)] bg-menu p-1 text-menu-foreground shadow-[var(--vscode-shadow-lg)]',
        'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-dropdown-menu-content-transform-origin]',
        className,
      )}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
);

/** Clickable dropdown row primitive used for menu commands. */
const DropdownMenuItem = ({
  className,
  inset,
  ref,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & { inset?: boolean }) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(
      'relative flex h-control-sm cursor-default select-none items-center gap-2 rounded-sm px-2 py-0.5 text-body outline-hidden transition-colors focus:bg-[var(--vscode-menu-selectionBackground)] focus:text-[var(--vscode-menu-selectionForeground)] data-disabled:pointer-events-none data-disabled:text-disabled [&>svg]:size-4 [&>svg]:shrink-0',
      inset && 'pl-8',
      className,
    )}
    {...props}
  />
);

/** Checkbox row primitive used by menus that toggle visible features/settings. */
const DropdownMenuCheckboxItem = ({
  className,
  children,
  checked,
  ref,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>) => (
  <DropdownMenuPrimitive.CheckboxItem
    ref={ref}
    className={cn(
      'relative flex h-control-sm cursor-default select-none items-center rounded-sm py-0.5 pl-8 pr-2 text-body outline-hidden transition-colors focus:bg-[var(--vscode-menu-selectionBackground)] focus:text-[var(--vscode-menu-selectionForeground)] data-disabled:pointer-events-none data-disabled:text-disabled',
      className,
    )}
    checked={checked}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.CheckboxItem>
);

/** Radio row primitive used by menus with a single selected option. */
const DropdownMenuRadioItem = ({
  className,
  children,
  ref,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem>) => (
  <DropdownMenuPrimitive.RadioItem
    ref={ref}
    className={cn(
      'relative flex h-control-sm cursor-default select-none items-center rounded-sm py-0.5 pl-8 pr-2 text-body outline-hidden transition-colors focus:bg-[var(--vscode-menu-selectionBackground)] focus:text-[var(--vscode-menu-selectionForeground)] data-disabled:pointer-events-none data-disabled:text-disabled',
      className,
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.RadioItem>
);

/** Non-interactive label row used to name dropdown sections. */
const DropdownMenuLabel = ({
  className,
  inset,
  ref,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label> & { inset?: boolean }) => (
  <DropdownMenuPrimitive.Label
    ref={ref}
    className={cn('px-2 py-1 text-label font-semibold', inset && 'pl-8', className)}
    {...props}
  />
);

/** Separator row used to visually divide dropdown item groups. */
const DropdownMenuSeparator = ({
  className,
  ref,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) => (
  <DropdownMenuPrimitive.Separator
    ref={ref}
    className={cn('-mx-1 my-1 h-px bg-panel', className)}
    {...props}
  />
);

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuRadioGroup,
};
