/**
 * Frontend-only tab presentation state.
 *
 * The durable Tab resource is owned by the workspace backend. These types keep
 * drafts, active selection, and input controls in memory while the server
 * remains the source of truth for tab identity and analysis ownership.
 */
import type { AnalysisKind, Tab, TopicModelingProjectionSelection } from '@/api';
import type { NodeInput } from '../nodeInputs/nodeInputsCore';

export type AnalysisTabInput = NodeInput;
export type AnalysisTabInputSets = Record<string, AnalysisTabInput[]>;

export interface AnalysisTab {
  tab_id: string;
  title: string;
  kind: AnalysisKind;
  input_sets: AnalysisTabInputSets;
  settings: Record<string, string>;
  annotation_correction_columns: Record<string, string>;
  stop_words: string[];
  topic_modeling_words_per_topic: number | null;
  topic_modeling_projection_selection: TopicModelingProjectionSelection | null;
  created_at?: string;
  modified_at?: string;
  revision?: number;
}

export const DEFAULT_TAB_INPUT_SET_ID = 'source';

export function tabFromResource(tab: Tab, local?: Partial<AnalysisTab>): AnalysisTab {
  return {
    tab_id: tab.id,
    title: local?.title ?? tab.name,
    kind: tab.kind,
    input_sets: local?.input_sets ?? { [DEFAULT_TAB_INPUT_SET_ID]: [] },
    settings: local?.settings ?? {},
    annotation_correction_columns: tab.annotation_correction_columns ?? {},
    stop_words: tab.stop_words ?? [],
    topic_modeling_words_per_topic: tab.topic_modeling_words_per_topic ?? null,
    topic_modeling_projection_selection: tab.topic_modeling_projection_selection ?? null,
    created_at: tab.created_at,
    modified_at: tab.modified_at,
    revision: tab.revision,
  };
}

export function getTabInputSet(
  tab: Pick<AnalysisTab, 'input_sets'> | null | undefined,
  selectorId = DEFAULT_TAB_INPUT_SET_ID,
): AnalysisTabInput[] {
  return tab?.input_sets[selectorId] ?? [];
}

export function reorderTabs(tabs: AnalysisTab[], orderedIds: string[]): AnalysisTab[] {
  const byId = new Map(tabs.map((tab) => [tab.tab_id, tab]));
  const ordered: AnalysisTab[] = [];
  const seen = new Set<string>();
  for (const id of orderedIds) {
    const tab = byId.get(id);
    if (tab && !seen.has(id)) {
      ordered.push(tab);
      seen.add(id);
    }
  }
  for (const tab of tabs) {
    if (!seen.has(tab.tab_id)) ordered.push(tab);
  }
  return ordered;
}
