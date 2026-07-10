import { Toaster as SonnerToaster, type ToasterProps } from 'sonner';

/**
 * App-configured toast host used by providers so feature code can call Sonner consistently.
 */
export function Toaster({ ...props }: ToasterProps) {
  return (
    <SonnerToaster
      position="top-center"
      toastOptions={{
        duration: 3500,
        classNames: {
          toast: 'bg-background border border-border text-foreground shadow-lg',
          title: 'text-sm font-medium',
          description: 'text-xs text-muted-foreground',
          actionButton: 'bg-primary text-primary-foreground',
          cancelButton: 'bg-muted text-muted-foreground',
        },
      }}
      richColors
      closeButton
      {...props}
    />
  );
}
