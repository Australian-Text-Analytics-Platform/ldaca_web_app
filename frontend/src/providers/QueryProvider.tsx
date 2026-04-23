import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import React from 'react';

/**
 * App-wide TanStack Query client.
 *
 * Exported separately so non-React callers (e.g. WebSocket task-stream
 * handlers) can invalidate or write to the cache directly. The eslint
 * override below is intentional — every other consumer imports from
 * `providers/QueryProvider`, so the client is effectively a singleton.
 */
// eslint-disable-next-line react-refresh/only-export-components -- queryClient is imported by non-component modules
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 min — after this, next read refetches.
      gcTime: 10 * 60 * 1000,   // 10 min — time a cache entry lingers when unused.
      retry: false,              // Avoid duplicate backend calls on transient errors.
      refetchOnWindowFocus: true,
      refetchOnReconnect: false,
    },
    mutations: {
      retry: false,
    },
  },
});

interface QueryProviderProps {
  children: React.ReactNode;
}

export const QueryProvider: React.FC<QueryProviderProps> = ({ children }) => (
  <QueryClientProvider client={queryClient}>
    {children}
    {process.env.NODE_ENV === 'development' && (
      <ReactQueryDevtools initialIsOpen={false} buttonPosition="top-left" />
    )}
  </QueryClientProvider>
);
