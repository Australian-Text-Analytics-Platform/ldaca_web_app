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
          toast:
            'rounded-md border border-[var(--vscode-widget-border)] bg-widget text-widget-foreground shadow-[var(--vscode-shadow-lg)]',
          title: 'text-body font-semibold',
          description: 'text-body-secondary text-description',
          actionButton: 'bg-button text-button-foreground',
          cancelButton: 'bg-panel text-description',
        },
      }}
      richColors
      closeButton
      {...props}
    />
  );
}
