import * as React from 'react';

import { cn } from '@/lib/utils';

/** Base card surface used by feature panels and dialogs that need a bounded content frame. */
const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('rounded-lg border bg-surface text-surface-foreground', className)}
      {...props}
    />
  ),
);
Card.displayName = 'Card';

/** Card header region used for titles/descriptions above card content. */
const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col space-y-1 p-3', className)} {...props} />
  ),
);
CardHeader.displayName = 'CardHeader';

/** Card title primitive used by panel/dialog cards for consistent heading weight. */
const CardTitle = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('font-semibold leading-none tracking-tight', className)}
      {...props}
    />
  ),
);
CardTitle.displayName = 'CardTitle';

/** Card description primitive used for supporting copy under card titles. */
const CardDescription = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('text-body-secondary text-description', className)} {...props} />
  ),
);
CardDescription.displayName = 'CardDescription';

/** Card body region used by feature panels and modal content areas. */
const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('p-3 pt-0', className)} {...props} />
  ),
);
CardContent.displayName = 'CardContent';

/** Card footer region used for action rows and pagination controls. */
const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-wrap items-center p-3 pt-0', className)} {...props} />
  ),
);
CardFooter.displayName = 'CardFooter';

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };
