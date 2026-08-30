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
  correctionColumns: Record<string, string>;
  stopWords: string[];
  wordsPerTopic: number | null;
  projectionSelection: TopicModelingProjectionSelection | null;
  created_at?: string;
  modified_at?: string;
  revision?: number;
}

export const DEFAULT_TAB_INPUT_SET_ID = 'source';

export function tabFromResource(tab: Tab, local?: Partial<AnalysisTab>): AnalysisTab {
  const presentation = {
    correctionColumns: {} as Record<string, string>,
    stopWords: [] as string[],
    wordsPerTopic: null as number | null,
    projectionSelection: null as TopicModelingProjectionSelection | null,
  };
  switch (tab.settings.kind) {
    case 'annotation':
      presentation.correctionColumns = tab.settings.correction_columns;
      break;
    case 'token_frequency':
      presentation.stopWords = tab.settings.stop_words.words;
      break;
    case 'topic_modeling':
      presentation.stopWords = tab.settings.stop_words.words;
      presentation.wordsPerTopic = tab.settings.words_per_topic;
      presentation.projectionSelection = tab.settings.projection_selection;
      break;
    default:
      break;
  }
  return {
    tab_id: tab.id,
    title: local?.title ?? tab.name,
    kind: tab.kind,
    input_sets: local?.input_sets ?? { [DEFAULT_TAB_INPUT_SET_ID]: [] },
    settings: local?.settings ?? {},
    ...presentation,
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
