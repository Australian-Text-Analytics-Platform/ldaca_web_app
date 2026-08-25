import { Suspense } from 'react';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { GuidanceVisitBoundary } from '@/features/guidance/GuidanceVisitBoundary';
import { ViewFeature } from '@/features/views/viewComponents';
import { useUIStore } from '@/stores';

/**
 * Suspense fallback used by `ViewRouter` while a feature bundle is loading.
 */
const Fallback = () => (
  <div className="flex items-center justify-center py-12">
    <div className="text-center">
      <div className="mx-auto mb-3 size-8 animate-spin rounded-full border-2 border-surface-border border-t-primary" />
      <p className="text-description text-body">Loading...</p>
    </div>
  </div>
);

/**
 * Renders the active analysis/data feature selected by the global UI store.
 * App shell routes users here so feature modules can remain lazy-loaded and
 * isolated behind a shared error boundary.
 * Rendered by `WorkspaceShell` inside the workspace content pane.
 */
export function ViewRouter() {
  const currentView = useUIStore((state) => state.currentView);
  return (
    <div className="min-h-0 min-w-0 w-full flex-1">
      <ErrorBoundary>
        <Suspense fallback={<Fallback />}>
          <GuidanceVisitBoundary view={currentView}>
            <ViewFeature view={currentView} />
          </GuidanceVisitBoundary>
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}
