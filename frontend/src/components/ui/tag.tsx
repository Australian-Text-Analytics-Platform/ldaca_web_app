import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

/** Used by `Tag` to map its tone and size props to semantic-chip styles. */
const tagVariants = cva(
  'inline-flex items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1 text-label-secondary font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-focus/30 disabled:pointer-events-none disabled:opacity-60',
  {
    variants: {
      tone: {
        /** Ref-forwarding tag primitive for compact semantic labels that can render as child elements. */
        muted: 'border-surface-border bg-panel/60 text-description',
        neutral: 'border-surface-border bg-editor text-foreground/80',
        info: 'border-info bg-info-background text-foreground',
        success:
          'border-[var(--vscode-charts-green)] bg-[color-mix(in_srgb,var(--vscode-charts-green)_12%,transparent)] text-foreground',
        warning: 'border-warning bg-warning-background text-warning',
        danger: 'border-rose-400 bg-rose-50 text-rose-900',
      },
      size: {
        sm: 'gap-1.5 px-2.5 py-0.5 text-[0.7rem]',
        md: 'px-3 py-1 text-label-secondary',
      },
    },
    defaultVariants: {
      tone: 'muted',
      size: 'md',
    },
  },
);

type TagProps = React.ComponentProps<'span'> &
  VariantProps<typeof tagVariants> & {
    asChild?: boolean;
  };

const Tag = React.forwardRef<React.ComponentRef<'span'>, TagProps>(
  ({ className, tone, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'span';

    return <Comp ref={ref} className={cn(tagVariants({ tone, size }), className)} {...props} />;
  },
);
Tag.displayName = 'Tag';

export { Tag };
