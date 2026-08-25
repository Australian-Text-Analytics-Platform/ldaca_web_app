import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Shared multiline input primitive used by form surfaces that need app-consistent focus/error styling.
 */
function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex field-sizing-content min-h-16 w-full rounded-sm border border-input-border bg-[var(--vscode-input-background)] px-1.5 py-1 text-body text-[var(--vscode-input-foreground)] outline-hidden placeholder:text-[var(--vscode-input-placeholderForeground)] focus-visible:border-focus focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-0 focus-visible:outline-focus disabled:cursor-not-allowed disabled:text-disabled aria-invalid:border-error aria-invalid:outline-error',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
