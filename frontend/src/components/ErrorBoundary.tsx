import { Component, type ReactNode, type ComponentType } from 'react';
import { captureException } from '@/lib/sentry';
import { Button } from '@/components/ui/button';

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ComponentType<{ error?: Error; resetError: () => void }>;
}

/**
 * Reusable React error boundary for isolating failures around login and
 * workspace surfaces. Callers can provide feature-specific fallbacks while the
 * default keeps the SPA recoverable with retry/reload actions.
 * Rendered by `WorkspaceShell`, `LoginScreen`, and `ViewRouter` so failures are
 * contained at workspace, auth-widget, and active-feature recovery scopes.
 * Flow: catch child render errors into state, choose a caller fallback or the default panel, then let fallbacks reset the boundary.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  /** Called by: React when an ErrorBoundary instance is mounted around children. */
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  /** Called by: React after a child render error so `render` can swap to a fallback. */
  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  /** Called by: React error recovery to expose stack details for developers and send to Sentry for production monitoring. */
  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Error Boundary caught an error:', error, errorInfo);
    captureException(error, {
      contexts: { react: errorInfo as unknown as Record<string, unknown> },
    });
  }

  /** Lets fallback UIs retry the child tree without forcing a full page reload. */
  resetError = () => {
    this.setState({ hasError: false, error: undefined });
  };

  /** Called by: React to render either protected children or the caller-selected fallback. */
  override render() {
    if (this.state.hasError) {
      const Fallback = this.props.fallback ?? DefaultErrorFallback;
      return <Fallback error={this.state.error} resetError={this.resetError} />;
    }

    return this.props.children;
  }
}

/**
 * Default fallback used when a caller only needs a generic recovery panel with
 * retry and reload controls.
 * Used by: ErrorBoundary when no feature-specific fallback component is passed.
 * Flow: show the error message, offer retry and reload actions, then reveal stack details only in development builds.
 */
function DefaultErrorFallback({ error, resetError }: { error?: Error; resetError: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] p-8 bg-error-background border border-error rounded-lg">
      <div className="text-error text-heading-2 font-semibold mb-4">Something went wrong</div>

      <div className="text-error text-body mb-6 max-w-md text-center">
        {/* eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- fall back to generic copy when message is an empty string, not only null/undefined */}
        {error?.message || 'An unexpected error occurred. Please try again.'}
      </div>

      <div className="space-x-4">
        <Button variant="destructive" onClick={resetError}>
          Try Again
        </Button>

        <Button
          variant="secondary"
          onClick={() => {
            window.location.reload();
          }}
        >
          Reload Page
        </Button>
      </div>

      {import.meta.env.DEV && error?.stack && (
        <details className="mt-6 w-full max-w-2xl">
          <summary className="cursor-pointer text-body text-description hover:text-foreground">
            Show Error Details
          </summary>
          <pre className="mt-2 p-4 bg-panel rounded-sm text-label-secondary text-foreground overflow-auto">
            {error.stack}
          </pre>
        </details>
      )}
    </div>
  );
}
