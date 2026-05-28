import React, { lazy, Suspense } from 'react';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useUIStore, type ViewType } from '@/stores';

/** Lazy data-loader chunk consumed by `VIEW_COMPONENTS` to keep startup lightweight. */
const DataLoaderFeature = lazy(() => import('@/features/data-loader/DataLoaderFeature'));
/** Lazy preprocessing chunk consumed by `VIEW_COMPONENTS` when the filter view is active. */
const DataPreprocessingFeature = lazy(() => import('@/features/analysis/data-preprocessing/DataPreprocessingFeature'));
/** Lazy concordance chunk consumed by `VIEW_COMPONENTS` when concordance is selected. */
const ConcordanceFeature = lazy(() => import('@/features/analysis/concordance/ConcordanceFeature'));
/** Lazy quotation chunk consumed by `VIEW_COMPONENTS` when quotation analysis is selected. */
const QuotationFeature = lazy(() => import('@/features/analysis/quotation/QuotationFeature'));
/** Lazy topic-modeling chunk consumed by `VIEW_COMPONENTS` when topic modeling is selected. */
const TopicModelingFeature = lazy(() => import('@/features/analysis/topic-modeling/TopicModelingFeature'));
/** Lazy sequential-analysis chunk consumed by `VIEW_COMPONENTS` when trends analysis is selected. */
const SequentialAnalysisFeature = lazy(() => import('@/features/analysis/sequential-analysis/SequentialAnalysisFeature'));
/** Lazy export chunk consumed by `VIEW_COMPONENTS` when export tools are selected. */
const ExportFeature = lazy(() => import('@/features/analysis/export/ExportFeature'));
/** Lazy token-frequency chunk consumed by `VIEW_COMPONENTS` when frequency analysis is selected. */
const TokenFrequencyFeature = lazy(() => import('@/features/analysis/token-frequency/TokenFrequencyFeature'));
/** Lazy AI annotator chunk consumed by `VIEW_COMPONENTS` when the optional annotator view is visible. */
const AiAnnotatorFeature = lazy(() => import('@/features/analysis/ai-annotator/AiAnnotatorFeature'));

/**
 * Each feature renders only when the matching `currentView` value is set.
 * Switching views unmounts the previous feature so its hooks reset cleanly.
 */
const VIEW_COMPONENTS: Record<ViewType, React.ComponentType> = {
  'data-loader': DataLoaderFeature,
  'filter': DataPreprocessingFeature,
  'token-frequency': TokenFrequencyFeature,
  'concordance': ConcordanceFeature,
  'analysis': SequentialAnalysisFeature,
  'topic-modeling': TopicModelingFeature,
  'quotation': QuotationFeature,
  'ai-annotator': AiAnnotatorFeature,
  'export': ExportFeature,
};

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
 * Rendered by: App inside the workspace content pane because the caller needs a focused rendering boundary for layout, accessibility, and state handoff steps.
 */
export function ViewRouter() {
  const currentView = useUIStore((state) => state.currentView);
  const FeatureComponent = VIEW_COMPONENTS[currentView];
  return (
    <div className="min-h-0 min-w-0 w-full flex-1">
      <ErrorBoundary>
        <Suspense fallback={<Fallback />}>
          <FeatureComponent />
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}
