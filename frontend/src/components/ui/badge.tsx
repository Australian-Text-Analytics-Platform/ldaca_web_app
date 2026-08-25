import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

/** Used by `Badge` to map its public variant prop to compact label and status-chip styles. */
const badgeVariants = cva(
  'inline-flex h-control-sm w-fit shrink-0 items-center justify-center gap-1 overflow-hidden whitespace-nowrap rounded-sm border px-1.5 py-0.5 text-badge font-semibold [&>svg]:size-3 [&>svg]:pointer-events-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-focus aria-invalid:border-error',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-button text-button-foreground [a&]:hover:bg-button/90',
        secondary:
          'border-transparent bg-button-secondary text-button-secondary-foreground [a&]:hover:bg-button-secondary/90',
        destructive: 'border-transparent bg-error text-button-foreground [a&]:hover:bg-error/85',
        outline: 'text-foreground [a&]:hover:bg-list-hover [a&]:hover:text-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

/** Used by: feature UIs that need compact status labels or `asChild` badge styling. */
function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'span';

  return (
    <Comp data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge };
