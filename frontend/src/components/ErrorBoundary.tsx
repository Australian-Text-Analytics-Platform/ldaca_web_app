import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ComponentType<{ error?: Error; resetError: () => void }>;
}

/**
 * Error boundary component to catch and handle React errors gracefully
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Error Boundary caught an error:', error, errorInfo);
  }

  resetError = () => {
    this.setState({ hasError: false, error: undefined });
  };

  render() {
    if (this.state.hasError) {
      const Fallback = this.props.fallback || DefaultErrorFallback;
      return <Fallback error={this.state.error} resetError={this.resetError} />;
    }

    return this.props.children;
  }
}

/**
 * Default error fallback component
 */
const DefaultErrorFallback: React.FC<{ error?: Error; resetError: () => void }> = ({ 
  error, 
  resetError 
}) => (
  <div className="flex flex-col items-center justify-center min-h-[400px] p-8 bg-red-50 border border-red-200 rounded-lg">
    <div className="text-red-600 text-xl font-semibold mb-4">
      Something went wrong
    </div>
    
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
    
    {process.env.NODE_ENV === 'development' && error?.stack && (
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

/**
 * Workspace-specific error fallback
 */
export const WorkspaceErrorFallback: React.FC<{ error?: Error; resetError: () => void }> = ({ 
  error, 
  resetError 
}) => (
  <div className="flex flex-col items-center justify-center h-full p-8 bg-yellow-50 border border-yellow-200 rounded-lg">
    <div className="text-yellow-800 text-lg font-semibold mb-4">
      Workspace Error
    </div>
    
    <div className="text-yellow-700 text-sm mb-6 max-w-md text-center">
      {error?.message || 'Unable to load workspace data. This might be a temporary issue.'}
    </div>
    
    <div className="space-x-4">
      <button
        onClick={resetError}
        className="px-4 py-2 bg-yellow-600 text-white rounded-md hover:bg-yellow-700 transition-colors"
      >
        Retry
      </button>
    </div>
  </div>
);
