import type { AnalysisKind, Tab } from '@/api';
import type { ViewType } from '@/features/views/viewIds';

export interface AnalysisNavigationDefinition {
  kind: AnalysisKind;
  view: ViewType;
  label: string;
}

/** Canonical navigation and user-facing identity for each backend-owned analysis Tab kind. */
const ANALYSIS_NAVIGATION: readonly AnalysisNavigationDefinition[] = [
  { kind: 'token_frequency', view: 'token-frequency', label: 'Token Frequency' },
  { kind: 'concordance', view: 'concordance', label: 'Concordance' },
  { kind: 'sequential', view: 'analysis', label: 'Trends' },
  { kind: 'topic_modeling', view: 'topic-modeling', label: 'Topic Modelling' },
  { kind: 'quotation', view: 'quotation', label: 'Quotation' },
  { kind: 'annotation', view: 'annotation', label: 'Annotation' },
];

const NAVIGATION_BY_KIND = new Map(ANALYSIS_NAVIGATION.map((item) => [item.kind, item]));
const NAVIGATION_BY_VIEW = new Map(ANALYSIS_NAVIGATION.map((item) => [item.view, item]));

export const analysisNavigationForKind = (kind: AnalysisKind): AnalysisNavigationDefinition => {
  const definition = NAVIGATION_BY_KIND.get(kind);
  if (!definition) throw new Error(`Unsupported analysis kind: ${kind}`);
  return definition;
};

export const analysisNavigationForView = (view: ViewType): AnalysisNavigationDefinition | null =>
  NAVIGATION_BY_VIEW.get(view) ?? null;

export const analysisTabQuickAccessLabel = (tab: Pick<Tab, 'kind' | 'name'>): string => {
  return `${analysisNavigationForKind(tab.kind).label}: ${tab.name}`;
};

export const filterAnalysisTabs = <T extends Pick<Tab, 'kind' | 'name'>>(
  tabs: readonly T[],
  query: string,
): T[] => {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return [...tabs];
  return tabs.filter((tab) =>
    analysisTabQuickAccessLabel(tab).toLocaleLowerCase().includes(normalizedQuery),
  );
};
