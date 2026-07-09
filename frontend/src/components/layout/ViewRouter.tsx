import { Suspense } from 'react';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ViewFeature } from '@/features/views/viewComponents';
import { useUIStore } from '@/stores';

/**
 * Suspense fallback used by `ViewRouter` while a feature bundle is loading.
 * Why: callers need a focused rendering boundary for layout, accessibility, and state handoff.
 */
const Fallback = () => (
  <div className="flex items-center justify-center py-12">
    <div className="text-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-3" />
      <p className="text-gray-600 text-sm">Loading...</p>
    </div>
  </div>
);

/**
 * Renders the active analysis/data feature selected by the global UI store.
 * App shell routes users here so feature modules can remain lazy-loaded and
 * isolated behind a shared error boundary.
 * Rendered by: App inside the workspace content pane.
 */
export function ViewRouter() {
  const currentView = useUIStore((state) => state.currentView);
  return (
    <div className="min-h-0 min-w-0 w-full flex-1">
      <ErrorBoundary>
        <Suspense fallback={<Fallback />}>
          <ViewFeature view={currentView} />
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}
