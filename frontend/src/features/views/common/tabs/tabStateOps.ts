/**
 * Frontend-only tab presentation state.
 *
 * The durable Tab resource is owned by the workspace backend. These types keep
 * drafts, active selection, and input controls in memory while the server
 * remains the source of truth for tab identity and analysis ownership.
 */
import type { AnalysisKind, Tab } from '@/api';

export interface AnalysisTabInput {
  node_id: string;
  column?: string | null;
}
export type AnalysisTabInputSets = Record<string, AnalysisTabInput[]>;

export interface AnalysisTab {
  tab_id: string;
  task_id: string | null;
  title: string;
  kind: AnalysisKind;
  input_sets: AnalysisTabInputSets;
  settings: Record<string, string>;
  created_at?: string;
  modified_at?: string;
  revision?: number;
}

interface AnalysisTabGroup {
  tabs: AnalysisTab[];
  active_tab_id: string | null;
}

export interface WorkspaceTabsState {
  groups: Record<string, AnalysisTabGroup>;
}

export const DEFAULT_TAB_INPUT_SET_ID = 'source';

export function tabFromResource(tab: Tab, local?: Partial<AnalysisTab>): AnalysisTab {
  return {
    tab_id: tab.id,
    task_id: tab.analysis_id,
    title: local?.title ?? tab.name,
    kind: tab.kind,
    input_sets: local?.input_sets ?? { [DEFAULT_TAB_INPUT_SET_ID]: [] },
    settings: local?.settings ?? {},
    created_at: tab.created_at,
    modified_at: tab.modified_at,
    revision: tab.revision,
  };
}

export function getTabs(
  state: WorkspaceTabsState | null | undefined,
  analysisType: string,
): AnalysisTab[] {
  return state?.groups[analysisType]?.tabs ?? [];
}

export function getActiveTabId(
  state: WorkspaceTabsState | null | undefined,
  analysisType: string,
): string | null {
  const group = state?.groups[analysisType];
  if (!group || group.tabs.length === 0) return null;
  return group.tabs.some((tab) => tab.tab_id === group.active_tab_id)
    ? group.active_tab_id
    : (group.tabs[0]?.tab_id ?? null);
}

export function getTabInputSet(
  tab: Pick<AnalysisTab, 'input_sets'> | null | undefined,
  selectorId = DEFAULT_TAB_INPUT_SET_ID,
): AnalysisTabInput[] {
  return tab?.input_sets[selectorId] ?? [];
}

export function getTabSetting(
  tab: Pick<AnalysisTab, 'settings'> | null | undefined,
  key: string,
): string | undefined {
  return tab?.settings[key];
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
