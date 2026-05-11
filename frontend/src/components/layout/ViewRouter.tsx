import React, { lazy, Suspense } from 'react';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useUIStore, type ViewType } from '@/stores';

const DataLoaderFeature = lazy(() => import('@/features/data-loader/DataLoaderFeature'));
const DataPreprocessingFeature = lazy(() => import('@/features/analysis/data-preprocessing/DataPreprocessingFeature'));
const ConcordanceFeature = lazy(() => import('@/features/analysis/concordance/ConcordanceFeature'));
const QuotationFeature = lazy(() => import('@/features/analysis/quotation/QuotationFeature'));
const TopicModelingFeature = lazy(() => import('@/features/analysis/topic-modeling/TopicModelingFeature'));
const SequentialAnalysisFeature = lazy(() => import('@/features/analysis/sequential-analysis/SequentialAnalysisFeature'));
const ExportFeature = lazy(() => import('@/features/analysis/export/ExportFeature'));
const TokenFrequencyFeature = lazy(() => import('@/features/analysis/token-frequency/TokenFrequencyFeature'));
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

const Fallback = () => (
  <div className="flex items-center justify-center py-12">
    <div className="text-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-3" />
      <p className="text-gray-600 text-sm">Loading...</p>
    </div>
  </div>
);

/**
 * Renders the analysis feature for the active `currentView`. Replaces the
 * 9-way `currentView === 'X' && <…/>` chain that lived in App.tsx.
 */
export const ViewRouter: React.FC = () => {
  const currentView = useUIStore((state) => state.currentView);
  const FeatureComponent = VIEW_COMPONENTS[currentView];
  return (
    <ErrorBoundary>
      <Suspense fallback={<Fallback />}>
        <FeatureComponent />
      </Suspense>
    </ErrorBoundary>
  );
};
