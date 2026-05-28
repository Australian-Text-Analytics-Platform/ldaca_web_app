import { cn } from '@/lib/utils';

/**
 * Loading placeholder primitive used by sidebar/menu surfaces while real content is unavailable.
 * Why: shared UI callers need a stable primitive boundary for layout, accessibility, and composition.
 */
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      className={cn('bg-accent animate-pulse rounded-md', className)}
      {...props}
    />
  );
}

export { Skeleton };
