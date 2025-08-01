import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import React from 'react';

// Create a query client with optimized defaults
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // How long data stays fresh (no refetch needed)
      staleTime: 5 * 60 * 1000, // 5 minutes
      // How long data stays in cache
      gcTime: 10 * 60 * 1000, // 10 minutes (renamed from cacheTime in v5)
      // Retry failed requests
      retry: (failureCount, error: any) => {
        // Don't retry auth errors
        if (error?.response?.status === 401 || error?.response?.status === 403) {
          return false;
        }
        // Retry up to 3 times for other errors
        return failureCount < 3;
      },
      // Refetch on window focus for important data
      refetchOnWindowFocus: true,
      // Don't refetch on reconnect by default (we'll enable for specific queries)
      refetchOnReconnect: false,
    },
    mutations: {
      // Retry mutations once
      retry: 1,
    },
  },
});

interface QueryProviderProps {
  children: React.ReactNode;
}

export const QueryProvider: React.FC<QueryProviderProps> = ({ children }) => {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {/* Only show devtools in development */}
      {process.env.NODE_ENV === 'development' && (
        <ReactQueryDevtools
          initialIsOpen={false}
        />
      )}
    </QueryClientProvider>
  );
};
