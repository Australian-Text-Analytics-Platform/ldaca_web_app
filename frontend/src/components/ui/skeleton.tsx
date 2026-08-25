import { cn } from '@/lib/utils';

/**
 * Loading placeholder primitive used by sidebar/menu surfaces while real content is unavailable.
 */
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      className={cn('bg-list-hover animate-pulse rounded-md', className)}
      {...props}
    />
  );
}

export { Skeleton };
