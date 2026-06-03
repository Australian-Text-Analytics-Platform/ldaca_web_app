import { Component, type ReactNode, type ComponentType } from 'react';
import * as Sentry from '@sentry/react';

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
 * Rendered by: App, LoginScreen, and ViewRouter because auth/workspace crashes should swap to recovery UI without blanking the whole SPA.
 * Flow: catch child render errors into state, choose a caller fallback or the default panel, then let fallbacks reset the boundary.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  /** Called by: React when an ErrorBoundary instance is mounted around children because the caller needs one documented boundary for the lookup, event, or state handoff step. */
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  /** Called by: React after a child render error so `render` can swap to a fallback because the caller needs a focused rendering boundary for layout, accessibility, and state handoff steps. */
  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  /** Called by: React error recovery to expose stack details for developers and send to Sentry for production monitoring. */
  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Error Boundary caught an error:', error, errorInfo);
    Sentry.captureException(error, {
      contexts: { react: errorInfo as unknown as Record<string, unknown> },
    });
  }

  /** Lets fallback UIs retry the child tree without forcing a full page reload. */
  resetError = () => {
    this.setState({ hasError: false, error: undefined });
  };

  /** Called by: React to render either protected children or the caller-selected fallback because the caller needs a focused rendering boundary for layout, accessibility, and state handoff steps. */
  override render() {
    if (this.state.hasError) {
      const Fallback = this.props.fallback || DefaultErrorFallback;
      return <Fallback error={this.state.error} resetError={this.resetError} />;
    }

    return this.props.children;
  }
}

/**
 * Default fallback used when a caller only needs a generic recovery panel with
 * retry and reload controls.
 * Used by: ErrorBoundary when no feature-specific fallback component is passed because the caller needs one documented boundary for the lookup, event, or state handoff step.
 * Flow: show the error message, offer retry and reload actions, then reveal stack details only in development builds.
 */
function DefaultErrorFallback({ error, resetError }: { error?: Error; resetError: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] p-8 bg-red-50 border border-red-200 rounded-lg">
      <div className="text-red-600 text-xl font-semibold mb-4">Something went wrong</div>

      <div className="text-red-700 text-sm mb-6 max-w-md text-center">
        {error?.message || 'An unexpected error occurred. Please try again.'}
      </div>

      <div className="space-x-4">
        <button
          onClick={resetError}
          className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors"
        >
          Try Again
        </button>

        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors"
        >
          Reload Page
        </button>
      </div>

      {import.meta.env.DEV && error?.stack && (
        <details className="mt-6 w-full max-w-2xl">
          <summary className="cursor-pointer text-sm text-gray-600 hover:text-gray-800">
            Show Error Details
          </summary>
          <pre className="mt-2 p-4 bg-gray-100 rounded text-xs text-gray-800 overflow-auto">
            {error.stack}
          </pre>
        </details>
      )}
    </div>
  );
}

