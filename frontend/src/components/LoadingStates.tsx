import React from 'react';

/**
 * Loading skeleton components for better perceived performance
 */

export const LoadingSkeleton: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`animate-pulse bg-gray-200 rounded ${className}`} />
);

export const TableLoadingSkeleton: React.FC = () => (
  <div className="animate-pulse space-y-4">
    <div className="flex space-x-4 mb-4">
      <div className="h-4 bg-gray-200 rounded w-1/4"></div>
      <div className="h-4 bg-gray-200 rounded w-1/4"></div>
      <div className="h-4 bg-gray-200 rounded w-1/4"></div>
      <div className="h-4 bg-gray-200 rounded w-1/4"></div>
    </div>
    {[...Array(8)].map((_, index) => (
      <div key={index} className="flex space-x-4">
        <div className="h-3 bg-gray-200 rounded w-1/4"></div>
        <div className="h-3 bg-gray-200 rounded w-1/4"></div>
        <div className="h-3 bg-gray-200 rounded w-1/4"></div>
        <div className="h-3 bg-gray-200 rounded w-1/4"></div>
      </div>
    ))}
  </div>
);

export const GraphLoadingSkeleton: React.FC = () => (
  <div className="h-full w-full bg-gray-50 flex items-center justify-center">
    <div className="flex flex-col items-center space-y-4">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      <div className="text-gray-600 text-sm">Loading workspace graph...</div>
    </div>
  </div>
);

export const WorkspaceLoadingSkeleton: React.FC = () => (
  <div className="p-6 space-y-6">
    <div className="flex items-center justify-between">
      <div className="space-y-2">
        <LoadingSkeleton className="h-6 w-48" />
        <LoadingSkeleton className="h-4 w-32" />
      </div>
      <div className="flex space-x-2">
        <LoadingSkeleton className="h-8 w-20" />
        <LoadingSkeleton className="h-8 w-20" />
      </div>
    </div>
    
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {[...Array(6)].map((_, index) => (
        <div key={index} className="border border-gray-200 rounded-lg p-4 space-y-3">
          <LoadingSkeleton className="h-5 w-3/4" />
          <LoadingSkeleton className="h-4 w-1/2" />
          <LoadingSkeleton className="h-3 w-full" />
          <LoadingSkeleton className="h-3 w-2/3" />
        </div>
      ))}
    </div>
  </div>
);

/**
 * Loading states with proper user feedback
 */
export const LoadingSpinner: React.FC<{ 
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}> = ({ size = 'md', className = '' }) => {
  const sizeClasses = {
    sm: 'h-4 w-4',
    md: 'h-8 w-8',
    lg: 'h-12 w-12',
  };

  return (
    <div className={`animate-spin rounded-full border-2 border-gray-300 border-t-blue-600 ${sizeClasses[size]} ${className}`} />
  );
};

export const LoadingOverlay: React.FC<{ 
  isVisible: boolean;
  message?: string;
}> = ({ isVisible, message = 'Loading...' }) => {
  if (!isVisible) return null;

  return (
    <div className="absolute inset-0 bg-white bg-opacity-75 flex items-center justify-center z-50">
      <div className="flex flex-col items-center space-y-3">
        <LoadingSpinner size="lg" />
        <div className="text-gray-600 text-sm font-medium">{message}</div>
      </div>
    </div>
  );
};

/**
 * Empty state components
 */
export const EmptyState: React.FC<{
  title: string;
  description?: string;
  icon?: React.ReactNode;
  action?: {
    label: string;
    onClick: () => void;
  };
}> = ({ title, description, icon, action }) => (
  <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
    {icon && (
      <div className="mb-4 text-gray-400">
        {icon}
      </div>
    )}
    
    <h3 className="text-lg font-medium text-gray-900 mb-2">
      {title}
    </h3>
    
    {description && (
      <p className="text-sm text-gray-500 mb-6 max-w-sm">
        {description}
      </p>
    )}
    
    {action && (
      <button
        onClick={action.onClick}
        className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 transition-colors"
      >
        {action.label}
      </button>
    )}
  </div>
);
