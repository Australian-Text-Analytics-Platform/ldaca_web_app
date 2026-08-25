import * as React from 'react';
import { cn } from '@/lib/utils';

export interface InsetCardProps extends React.HTMLAttributes<HTMLDivElement> {
  innerClassName?: string;
  innerRef?: React.Ref<HTMLDivElement>;
}

/**
 * Ref-forwarding card shell used by workspace split panes. It mirrors the
 * sidebar inset treatment so graph/table cards keep bounded flat surfaces and
 * rounded-sm corners inside overflow-constrained layout parents.
 */
export const InsetCard = React.forwardRef<HTMLDivElement, InsetCardProps>(
  ({ className, innerClassName, innerRef, children, ...props }, ref) => (
    <div ref={ref} className={cn('flex min-h-0 min-w-0 p-2', className)} {...props}>
      <div
        ref={innerRef}
        className={cn(
          'flex w-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border bg-surface',
          innerClassName,
        )}
      >
        {children}
      </div>
    </div>
  ),
);
InsetCard.displayName = 'InsetCard';
