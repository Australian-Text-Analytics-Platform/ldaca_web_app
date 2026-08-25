import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Shared text input primitive used by forms, pagination jump controls, and settings dialogs.
 */
function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'h-control w-full min-w-0 rounded-sm border border-input-border bg-[var(--vscode-input-background)] px-1.5 py-1 text-body text-[var(--vscode-input-foreground)] outline-hidden placeholder:text-[var(--vscode-input-placeholderForeground)] file:inline-flex file:h-control-sm file:border-0 file:bg-transparent file:text-label file:font-semibold disabled:cursor-not-allowed disabled:text-disabled',
        'focus-visible:border-focus focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-0 focus-visible:outline-focus',
        'aria-invalid:border-error aria-invalid:outline-error',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
