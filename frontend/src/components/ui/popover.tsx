import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';

import { cn } from '@/lib/utils';

/** Used by: lightweight inline panels such as pagination jumps and operation pickers. */
function Popover({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

/** Used by: controls that open inline popover panels. */
function PopoverTrigger({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

type PopoverContentProps = React.ComponentProps<typeof PopoverPrimitive.Content> & {
  /**
   * Render content inline instead of through a body portal. Used by dialog-nested
   * popovers whose scrollable content must remain inside the dialog scroll-lock
   * boundary so mouse-wheel events keep reaching the popover viewport.
   */
  portalled?: boolean;
};

/** Used by: popover consumers that need app-consistent floating panel styling. */
function PopoverContent({
  className,
  align = 'center',
  sideOffset = 4,
  portalled = true,
  ...props
}: PopoverContentProps) {
  const content = (
    <PopoverPrimitive.Content
      data-slot="popover-content"
      align={align}
      sideOffset={sideOffset}
      className={cn(
        'z-50 w-72 origin-(--radix-popover-content-transform-origin) rounded-md border border-[var(--vscode-widget-border)] bg-widget p-2 text-widget-foreground shadow-[var(--vscode-shadow-lg)] outline-hidden data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
        className,
      )}
      {...props}
    />
  );
  return portalled ? <PopoverPrimitive.Portal>{content}</PopoverPrimitive.Portal> : content;
}

/** Used by: popover consumers that position content relative to custom anchors. */
function PopoverAnchor({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />;
}

/** Used by: popover panels with title and description copy. */
function PopoverHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="popover-header"
      className={cn('flex flex-col gap-1 text-body', className)}
      {...props}
    />
  );
}

/** Used by: PopoverHeader title rows. */
function PopoverTitle({ className, ...props }: React.ComponentProps<'h2'>) {
  return <div data-slot="popover-title" className={cn('font-medium', className)} {...props} />;
}

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor, PopoverHeader, PopoverTitle };
