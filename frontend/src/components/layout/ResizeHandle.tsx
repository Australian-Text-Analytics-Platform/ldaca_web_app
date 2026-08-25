import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

export interface ResizeHandleProps extends ComponentProps<'div'> {
  orientation: 'horizontal' | 'vertical';
  variant?: 'grip' | 'line';
  isDragging?: boolean;
  disabled?: boolean;
}

/**
 * Shared visual shell for draggable pane separators.
 *
 * The interaction and sizing contract stays with each resize hook. This
 * component only supplies the full-boundary hover, focus, and drag highlight,
 * with an optional persistent three-dot affordance for higher-level splits.
 */
export function ResizeHandle({
  orientation,
  variant = 'grip',
  isDragging = false,
  disabled = false,
  className,
  role,
  tabIndex,
  children,
  ...props
}: ResizeHandleProps) {
  const isVertical = orientation === 'vertical';
  const inactiveGripClasses =
    'opacity-50 group-hover/resize-handle:opacity-0 group-hover/resize-handle:delay-300 group-focus-visible/resize-handle:opacity-0 group-focus-visible/resize-handle:delay-0';
  const inactiveHighlightClasses =
    'opacity-0 group-hover/resize-handle:opacity-100 group-hover/resize-handle:delay-300 group-focus-visible/resize-handle:opacity-100 group-focus-visible/resize-handle:delay-0';

  return (
    <div
      data-slot="resize-handle"
      data-orientation={orientation}
      data-variant={variant}
      data-dragging={isDragging ? 'true' : 'false'}
      data-disabled={disabled ? 'true' : 'false'}
      role={role ?? 'separator'}
      aria-orientation={orientation}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : tabIndex}
      className={cn(
        'group/resize-handle relative flex shrink-0 touch-none items-center justify-center select-none outline-none',
        isVertical ? 'w-2 cursor-col-resize' : 'h-2 cursor-row-resize',
        disabled && 'pointer-events-none cursor-default',
        className,
      )}
      {...props}
    >
      <span
        data-slot="resize-handle-highlight"
        data-testid="resize-handle-highlight"
        aria-hidden="true"
        className={cn(
          'bg-resize-handle-active pointer-events-none absolute rounded-full transition-opacity duration-100 ease-out motion-reduce:transition-none forced-colors:bg-[CanvasText]',
          isVertical
            ? 'inset-y-0 left-1/2 w-1 -translate-x-1/2'
            : 'inset-x-0 top-1/2 h-1 -translate-y-1/2',
          disabled ? 'opacity-0' : isDragging ? 'opacity-100 delay-0' : inactiveHighlightClasses,
        )}
      />
      {variant === 'grip' ? (
        <span
          data-slot="resize-handle-grip"
          data-testid="resize-handle-grip"
          aria-hidden="true"
          className={cn(
            'bg-foreground/30 text-foreground/30 pointer-events-none absolute size-0.5 rounded-full transition-opacity duration-100 ease-out motion-reduce:transition-none forced-colors:bg-[CanvasText] forced-colors:text-[CanvasText]',
            'top-1/2 left-1/2 -translate-1/2',
            isVertical
              ? 'shadow-[0_-4px_currentColor,0_4px_currentColor]'
              : 'shadow-[-4px_0_currentColor,4px_0_currentColor]',
            disabled || isDragging ? 'opacity-0 delay-0' : inactiveGripClasses,
          )}
        />
      ) : null}
      {children}
    </div>
  );
}
