import { type ReactNode } from 'react';

interface AuthProviderCardProps {
  isLoading?: boolean;
  error?: string | null;
  children: ReactNode;
}

/**
 * Shared layout card for OAuth provider sign-in buttons.
 * Renders the standard error banner and loading spinner around
 * the provider-specific button passed as children.
 */
export function AuthProviderCard({ isLoading, error, children }: AuthProviderCardProps) {
  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-sm border border-error bg-error-background p-3 text-error">
          {error}
        </div>
      )}
      {children}
      {isLoading && (
        <div className="flex items-center justify-center">
          <div className="mr-2 size-4 animate-spin rounded-full border-2 border-surface-border border-t-primary" />
          <span className="text-body text-description">Signing in...</span>
        </div>
      )}
    </div>
  );
}
