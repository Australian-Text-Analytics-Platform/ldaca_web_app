import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import React from 'react';

/**
 * App-wide TanStack Query client.
 *
 * Module-private singleton owned by QueryProvider; the provider injects it via
 * QueryClientProvider so the whole component tree shares one cache.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 min — after this, next read refetches.
      gcTime: 10 * 60 * 1000, // 10 min — time a cache entry lingers when unused.
      retry: false, // Avoid duplicate backend calls on transient errors.
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

/** Wraps the SPA with the shared query client and devtools during local development. */
/** Used by: src/App.tsx because those importers need shared behavior from one implementation rather than divergent local copies. */
export function QueryProvider({ children }: QueryProviderProps) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {process.env.NODE_ENV === 'development' && (
        <ReactQueryDevtools initialIsOpen={false} buttonPosition="top-left" />
      )}
    </QueryClientProvider>
  );
}
