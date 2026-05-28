import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

/** Tag tone/size variants used for semantic chips in analysis and workspace screens. */
const tagVariants = cva(
  'inline-flex items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-60',
  {
    variants: {
      tone: {
        /** Ref-forwarding tag primitive for compact semantic labels that can render as child elements. */
        muted: 'border-border bg-muted/60 text-muted-foreground',
        neutral: 'border-border bg-background text-foreground/80',
        info: 'border-sky-300/70 bg-sky-50 text-sky-900',
        success: 'border-emerald-300/70 bg-emerald-50 text-emerald-900',
        warning: 'border-amber-400 bg-amber-50 text-amber-900',
        danger: 'border-rose-400 bg-rose-50 text-rose-900',
      },
      size: {
        sm: 'gap-1.5 px-2.5 py-0.5 text-[0.7rem]',
        md: 'px-3 py-1 text-xs',
      },
    },
    defaultVariants: {
      tone: 'muted',
      size: 'md',
    },
  },
);

export type TagProps = React.ComponentProps<'span'> &
  VariantProps<typeof tagVariants> & {
    asChild?: boolean;
  };

const Tag = React.forwardRef<React.ElementRef<'span'>, TagProps>(
  ({ className, tone, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'span';

    return <Comp ref={ref} className={cn(tagVariants({ tone, size }), className)} {...props} />;
  },
);
Tag.displayName = 'Tag';

// eslint-disable-next-line react-refresh/only-export-components -- Shadcn UI pattern: CVA variants must be co-exported for consumer styling
export { Tag, tagVariants };
