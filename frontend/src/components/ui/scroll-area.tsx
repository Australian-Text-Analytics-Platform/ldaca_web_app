import * as React from 'react';
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area';

import { cn } from '@/lib/utils';

type ScrollAreaScrollbarOption = 'vertical' | 'horizontal' | 'both' | 'none';

type ScrollAreaProps = React.ComponentProps<typeof ScrollAreaPrimitive.Root> & {
  scrollbars?: ScrollAreaScrollbarOption;
  children?: React.ReactNode;
  className?: string;
};

/**
 * Scroll area wrapper used by overflow-heavy panels that need styled Radix scrollbars.
 * Why: overflow panels need Radix scrollbars with app styling while preserving the caller's viewport content.
 * Flow: render Root and Viewport, conditionally mount vertical/horizontal ScrollBar primitives, then add the Radix corner when both axes show.
 */
function ScrollArea({ className, children, scrollbars = 'vertical', ...props }: ScrollAreaProps) {
  const showVertical = scrollbars === 'vertical' || scrollbars === 'both';
  const showHorizontal = scrollbars === 'horizontal' || scrollbars === 'both';

  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn('group relative overflow-hidden', className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        className="focus-visible:ring-ring/50 size-full max-h-[inherit] rounded-[inherit] transition-[color,box-shadow] outline-hidden focus-visible:ring-[3px] focus-visible:outline-1"
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      {showVertical ? <ScrollBar forceMount /> : null}
      {showHorizontal ? <ScrollBar forceMount orientation="horizontal" /> : null}
      {showVertical && showHorizontal ? <ScrollAreaPrimitive.Corner /> : null}
    </ScrollAreaPrimitive.Root>
  );
}

/**
 * Scrollbar renderer used by `ScrollArea` for vertical and horizontal rails.
 * Why: shared UI callers need a stable primitive boundary for layout, accessibility, and composition.
 * Flow: compose orientation-specific rail classes, render the Radix ScrollAreaScrollbar, then nest the styled thumb primitive.
 */
function ScrollBar({
  className,
  orientation = 'vertical',
  forceMount,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      forceMount={forceMount}
      className={cn(
        'z-10 flex select-none touch-none p-px opacity-0 transition-opacity duration-200 group-hover:opacity-100 hover:opacity-100 focus-visible:opacity-100',
        orientation === 'vertical' && 'h-full w-2.5 border-l border-l-transparent',
        orientation === 'horizontal' && 'h-2.5 flex-col border-t border-t-transparent opacity-100',
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb
        data-slot="scroll-area-thumb"
        className="bg-border relative flex-1 rounded-full"
      />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  );
}

export { ScrollArea, ScrollBar };
