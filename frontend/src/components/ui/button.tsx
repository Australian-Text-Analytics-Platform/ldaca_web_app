import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

/** Button geometry and states follow VS Code's pinned `monaco-text-button` styles. */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-sm border border-transparent text-label font-normal leading-4 transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-default disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-button text-button-foreground hover:bg-[var(--vscode-button-hoverBackground)]',
        destructive: 'bg-error text-button-foreground hover:bg-error/85',
        outline:
          'border-input-border bg-[var(--vscode-input-background)] text-foreground hover:bg-list-hover',
        secondary:
          'border-[var(--vscode-button-secondaryBorder)] bg-button-secondary text-button-secondary-foreground hover:bg-[var(--vscode-button-secondaryHoverBackground)]',
        ghost: 'hover:bg-list-hover hover:text-foreground',
        link: 'text-link underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-control px-[8px] py-[4px]',
        sm: 'h-control-sm px-[6px] py-[3px] text-label-secondary leading-[14px]',
        lg: 'h-control px-[12px] py-[4px]',
        icon: 'size-control p-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

/**
 * Shared button primitive used across app chrome, dialogs, and feature panels.
 * It preserves the `asChild` composition hook so links and Radix actions
 * can receive the same visual variants without changing semantics.
 */
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = 'Button';

// eslint-disable-next-line react-refresh/only-export-components -- CVA variants are shared with composed controls.
export { Button, buttonVariants };
