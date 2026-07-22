import { lazy, type ComponentProps, type ComponentType, type LazyExoticComponent } from 'react';
import { ANALYSIS_TAB_GROUPS } from '@/features/views/common/analysisIds';
import { AnalysisTabsHost } from '@/features/views/common/tabs/AnalysisTabsHost';
import type { ViewType } from '@/features/views/viewIds';

type AnalysisFeatureComponent = ComponentProps<typeof AnalysisTabsHost>['Feature'];

const createTabbedFeatureLoader = <TModule,>({
  load,
  pickFeature,
  tabGroup,
  displayName,
}: {
  load: () => Promise<TModule>;
  pickFeature: (module: TModule) => AnalysisFeatureComponent;
  tabGroup: string;
  displayName: string;
}) =>
  lazy(async () => {
    const module = await load();
    const Feature = pickFeature(module);
    function TabbedFeature() {
      return <AnalysisTabsHost tabGroup={tabGroup} Feature={Feature} />;
    }
    TabbedFeature.displayName = displayName;
    return { default: TabbedFeature };
  });

const DataLoaderFeature = lazy(() => import('@/features/views/data-loader/DataLoaderFeature'));
const DataPreprocessingFeature = lazy(
  () => import('@/features/views/preprocessing/DataPreprocessingFeature'),
);
const TokenFrequencyFeature = createTabbedFeatureLoader({
  load: () => import('@/features/views/token-frequency/TokenFrequencyFeature'),
  pickFeature: (module) => module.default,
  tabGroup: ANALYSIS_TAB_GROUPS.tokenFrequencies,
  displayName: 'TokenFrequencyTabbedFeature',
});
const ConcordanceFeature = createTabbedFeatureLoader({
  load: () => import('@/features/views/concordance/ConcordanceFeature'),
  pickFeature: (module) => module.ConcordanceFeature,
  tabGroup: ANALYSIS_TAB_GROUPS.concordance,
  displayName: 'ConcordanceTabbedFeature',
});
const SequentialAnalysisFeature = createTabbedFeatureLoader({
  load: () => import('@/features/views/sequential-analysis/SequentialAnalysisFeature'),
  pickFeature: (module) => module.default,
  tabGroup: ANALYSIS_TAB_GROUPS.sequential,
  displayName: 'SequentialAnalysisTabbedFeature',
});
const TopicModelingFeature = createTabbedFeatureLoader({
  load: () => import('@/features/views/topic-modeling/TopicModelingFeature'),
  pickFeature: (module) => module.default,
  tabGroup: ANALYSIS_TAB_GROUPS.topicModeling,
  displayName: 'TopicModelingTabbedFeature',
});
const QuotationFeature = createTabbedFeatureLoader({
  load: () => import('@/features/views/quotation/QuotationFeature'),
  pickFeature: (module) => module.default,
  tabGroup: ANALYSIS_TAB_GROUPS.quotation,
  displayName: 'QuotationTabbedFeature',
});
const AnnotationFeature = createTabbedFeatureLoader({
  load: () => import('@/features/views/annotation/AnnotationFeature'),
  pickFeature: (module) => module.default,
  tabGroup: ANALYSIS_TAB_GROUPS.annotation,
  displayName: 'AnnotationTabbedFeature',
});
const ExportFeature = lazy(() => import('@/features/views/export/ExportFeature'));

const VIEW_COMPONENT_BY_ID: Record<ViewType, LazyExoticComponent<ComponentType>> = {
  'data-loader': DataLoaderFeature,
  filter: DataPreprocessingFeature,
  'token-frequency': TokenFrequencyFeature,
  concordance: ConcordanceFeature,
  analysis: SequentialAnalysisFeature,
  'topic-modeling': TopicModelingFeature,
  quotation: QuotationFeature,
  annotation: AnnotationFeature,
  export: ExportFeature,
};

/**
 * Renders the lazy feature component for a view id.
 *
 * Used by: ViewRouter so routing has no label/icon/tabbed metadata duplication,
 * while Fast Refresh sees this file as a component-only module.
 */
export function ViewFeature({ view }: { view: ViewType }) {
  const FeatureComponent = VIEW_COMPONENT_BY_ID[view];
  return <FeatureComponent />;
}
