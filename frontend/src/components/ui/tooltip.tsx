'use client';

import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';

import { cn } from '@/lib/utils';

/** Tooltip provider used by app shells to control hover delay for child tooltips. */
const TooltipProvider = TooltipPrimitive.Provider;

/** Tooltip root primitive used by icon buttons and disabled-reason wrappers. */
const Tooltip = TooltipPrimitive.Root;

/** Tooltip trigger primitive used to attach hover/focus behavior to controls. */
const TooltipTrigger = TooltipPrimitive.Trigger;

/** Tooltip content wrapper with the app's compact dark surface styling. */
const TooltipContent = React.forwardRef<
  React.ComponentRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-50 overflow-hidden rounded-md border border-[var(--vscode-widget-border)] bg-widget px-2 py-1 text-label-secondary text-widget-foreground shadow-[var(--vscode-shadow-lg)] animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 origin-[--radix-tooltip-content-transform-origin]',
        className,
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
