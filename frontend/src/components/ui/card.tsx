import * as React from 'react';

import { cn } from '@/lib/utils';

/** Base card surface used by feature panels and dialogs that need a bounded content frame. */
const Card = ({ className, ref, ...props }: React.ComponentProps<'div'>) => (
  <div
    ref={ref}
    className={cn('rounded-lg border bg-surface text-surface-foreground', className)}
    {...props}
  />
);

/** Card header region used for titles/descriptions above card content. */
const CardHeader = ({ className, ref, ...props }: React.ComponentProps<'div'>) => (
  <div ref={ref} className={cn('flex flex-col space-y-1 p-3', className)} {...props} />
);

/** Card title primitive used by panel/dialog cards for consistent heading weight. */
const CardTitle = ({ className, ref, ...props }: React.ComponentProps<'div'>) => (
  <div
    ref={ref}
    className={cn('font-semibold leading-none tracking-tight', className)}
    {...props}
  />
);

/** Card description primitive used for supporting copy under card titles. */
const CardDescription = ({ className, ref, ...props }: React.ComponentProps<'div'>) => (
  <div ref={ref} className={cn('text-body-secondary text-description', className)} {...props} />
);

/** Card body region used by feature panels and modal content areas. */
const CardContent = ({ className, ref, ...props }: React.ComponentProps<'div'>) => (
  <div ref={ref} className={cn('p-3 pt-0', className)} {...props} />
);

/** Card footer region used for action rows and pagination controls. */
const CardFooter = ({ className, ref, ...props }: React.ComponentProps<'div'>) => (
  <div ref={ref} className={cn('flex flex-wrap items-center p-3 pt-0', className)} {...props} />
);

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };
