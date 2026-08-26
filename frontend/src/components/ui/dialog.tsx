import * as React from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';
import { X } from 'lucide-react';
import { ModalLayerRegistration } from '@/features/guidance/ModalLayerRegistration';

/** Radix dialog root re-export used by modal wrappers throughout the app. */
const Dialog = DialogPrimitive.Root;

/** Dialog trigger primitive for callers that need Radix-managed open state. */
const DialogTrigger = DialogPrimitive.Trigger;

/** Dialog portal primitive used by content wrappers to render outside normal layout flow. */
const DialogPortal = DialogPrimitive.Portal;

/** Dialog close primitive used by consumers that need custom close controls. */
const DialogClose = DialogPrimitive.Close;

/** Shared modal backdrop used by `DialogContent` for app dialogs. */
const DialogOverlay = ({
  className,
  ref,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-overlay data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      className,
    )}
    {...props}
  />
);

/** Centered modal content wrapper used by panels and document modals. */
const DialogContent = ({
  className,
  children,
  ref,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) => (
  <DialogPortal>
    <DialogOverlay />
    <ModalLayerRegistration>
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg origin-center translate-x-[-50%] translate-y-[-50%] gap-3 rounded-lg border border-[var(--vscode-widget-border)] bg-widget p-4 text-widget-foreground shadow-[var(--vscode-shadow-lg)] duration-150 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="absolute right-2 top-2 flex size-control-sm items-center justify-center rounded-sm text-description hover:bg-list-hover hover:text-foreground focus-visible:outline focus-visible:outline-1 focus-visible:outline-focus disabled:pointer-events-none">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </ModalLayerRegistration>
  </DialogPortal>
);

/**
 * Header layout helper used by dialogs for title/description grouping.
 */
const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col space-y-1.5 text-center sm:text-left', className)} {...props} />
);
DialogHeader.displayName = 'DialogHeader';

/**
 * Footer layout helper used by dialogs for action button rows.
 */
const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn('flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2', className)}
    {...props}
  />
);
DialogFooter.displayName = 'DialogFooter';

/** Accessible dialog title primitive consumed by modal content. */
const DialogTitle = ({
  className,
  ref,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-heading-3 font-semibold leading-tight', className)}
    {...props}
  />
);

/** Accessible dialog description primitive consumed by modal content. */
const DialogDescription = ({
  className,
  ref,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-body-secondary text-description', className)}
    {...props}
  />
);

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
