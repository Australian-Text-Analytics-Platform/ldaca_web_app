'use client';

import * as React from 'react';
import { AlertDialog as AlertDialogPrimitive } from 'radix-ui';

import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';
import { ModalLayerRegistration } from '@/features/guidance/ModalLayerRegistration';

/** Radix alert dialog root used for confirmation/destructive decision flows. */
const AlertDialog = AlertDialogPrimitive.Root;

/** Portal primitive used by alert dialog content to escape normal layout flow. */
const AlertDialogPortal = AlertDialogPrimitive.Portal;

/** Shared alert-dialog backdrop for confirmation modals. */
const AlertDialogOverlay = ({
  className,
  ref,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Overlay>) => (
  <AlertDialogPrimitive.Overlay
    className={cn(
      'fixed inset-0 z-50 bg-overlay data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      className,
    )}
    {...props}
    ref={ref}
  />
);

/** Centered alert dialog content used by destructive and confirmation wrappers. */
const AlertDialogContent = ({
  className,
  ref,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Content>) => (
  <AlertDialogPortal>
    <AlertDialogOverlay />
    <ModalLayerRegistration>
      <AlertDialogPrimitive.Content
        ref={ref}
        className={cn(
          'fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg origin-center translate-x-[-50%] translate-y-[-50%] gap-3 rounded-lg border border-[var(--vscode-widget-border)] bg-widget p-4 text-widget-foreground shadow-[var(--vscode-shadow-lg)] duration-150 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          className,
        )}
        {...props}
      />
    </ModalLayerRegistration>
  </AlertDialogPortal>
);

/** Used by: alert-dialog content that renders title and description copy. */
const AlertDialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col space-y-2 text-center sm:text-left', className)} {...props} />
);
AlertDialogHeader.displayName = 'AlertDialogHeader';

/** Used by: alert-dialog content that renders cancel/confirm action rows. */
const AlertDialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn('flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2', className)}
    {...props}
  />
);
AlertDialogFooter.displayName = 'AlertDialogFooter';

/** Alert dialog title primitive used by confirmation prompts. */
const AlertDialogTitle = ({
  className,
  ref,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Title>) => (
  <AlertDialogPrimitive.Title
    ref={ref}
    className={cn('text-heading-3 font-semibold', className)}
    {...props}
  />
);

/** Alert dialog description primitive used to explain confirmation consequences. */
const AlertDialogDescription = ({
  className,
  ref,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) => (
  <AlertDialogPrimitive.Description
    ref={ref}
    className={cn('text-body-secondary text-description', className)}
    {...props}
  />
);

/** Confirm action button wrapper used by reusable confirmation dialogs. */
const AlertDialogAction = ({
  className,
  ref,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Action>) => (
  <AlertDialogPrimitive.Action ref={ref} className={cn(buttonVariants(), className)} {...props} />
);

/** Cancel action button wrapper used by alert dialogs for non-destructive escape. */
const AlertDialogCancel = ({
  className,
  ref,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Cancel>) => (
  <AlertDialogPrimitive.Cancel
    ref={ref}
    className={cn(buttonVariants({ variant: 'outline' }), 'mt-2 sm:mt-0', className)}
    {...props}
  />
);

export {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
};
