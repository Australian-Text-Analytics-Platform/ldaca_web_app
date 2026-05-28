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
        <div className="p-3 bg-red-100 border border-red-400 text-red-700 rounded">
          {error}
        </div>
      )}
      {children}
      {isLoading && (
        <div className="flex items-center justify-center">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-2"></div>
          <span className="text-sm text-gray-600">Signing in...</span>
        </div>
      )}
    </div>
  );
}
