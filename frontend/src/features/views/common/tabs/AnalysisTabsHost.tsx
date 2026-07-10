/**
 * Generic Chrome-style tabbed shell shared by every analysis view. It owns the
 * per-workspace tab group for a given analysis type and renders the active
 * tab's analysis panel beneath the protruding tab strip.
 *
 * Why this exists: the orchestration (load tab group → auto-create one tab on entry →
 * draw the tab bar → mount the feature keyed by the active tab) is identical
 * across concordance, token-frequency, quotation, topic-modeling,
 * sequential-analysis, and annotation. Centralizing it here means every view
 * shares exactly the same tab UI and behaviour, while viewComponents supplies
 * only its tab-group namespace + panel component.
 *
 * Rendered by: the lazy tabbed feature loaders in `viewComponents.tsx`, which
 * ViewRouter resolves from the active view id.
 * Flow: resolve workspace and preference state, load this workspace's tab group, auto-create
 * one empty tab only when entering an empty group, render the shared tab bar
 * only when the user preference enables it, then mount ``Feature`` keyed by the
 * active tab id so switching tabs gives each tab a fresh, independently-hydrated
 * panel instance. WorkspaceShell owns the global single-tab cleanup pass when
 * the preference is off.
 */
import { useEffect, useRef, type ComponentType } from 'react';
import type { AnalysisTabInput } from '@/api';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import { usePreferencesStore } from '@/stores/preferencesStore';
import { AnalysisTabbedPanel } from './AnalysisTabbedPanel';
import type { AnalysisTabInputSets } from './tabStateOps';
import { useWorkspaceTabs } from './useWorkspaceTabs';

/**
 * Canonical owner passed to every analysis feature. Values are normalized at
 * this boundary and persistence commands already capture the active tab id, so
 * feature code never branches on whether it happens to be tab-mounted.
 */
export interface AnalysisFeatureHost {
  taskId: string | null;
  inputSets: AnalysisTabInputSets;
  settings: Record<string, string>;
  setTaskId: (taskId: string | null) => void;
  setInputSet: (selectorId: string, inputs: AnalysisTabInput[]) => void;
  setSetting: (key: string, value: string) => void;
}

export interface AnalysisTabFeatureProps {
  host: AnalysisFeatureHost;
}

export interface AnalysisTabsHostProps {
  /** Tab-group namespace; matches the backend analysis type for this view. */
  tabGroup: string;
  /** The single-analysis panel mounted for the active tab. */
  Feature: ComponentType<AnalysisTabFeatureProps>;
}

/**
 * Hosts one analysis view's tab strip and the active tab's panel.
 * Used by: viewComponents' tabbed feature loaders because the tab bar and the
 * keyed feature panel both need the same live tab list, active id, and mutators.
 * Flow: read tab group → ensure a tab exists → render optional bar + keyed panel.
 */
export function AnalysisTabsHost({ tabGroup, Feature }: AnalysisTabsHostProps) {
  const { currentWorkspaceId } = useWorkspaceData();
  const analysisMultiTabEnabled = usePreferencesStore((state) => state.analysisMultiTabEnabled);
  const autoCreateKeyRef = useRef<string | null>(null);

  const {
    tabs,
    activeTabId,
    isLoading,
    createTab,
    closeTab,
    renameTab,
    setActiveTab,
    reorderTabs,
    setTabTask,
    setTabInputSet,
    setTabSetting,
  } = useWorkspaceTabs(currentWorkspaceId, tabGroup);

  // Requirement: entering an empty analysis view presents one ready tab, but
  // closing the final tab while already there must leave the group empty until
  // the user clicks +. Gate on !isLoading so persisted groups hydrate first.
  useEffect(() => {
    if (!currentWorkspaceId) {
      autoCreateKeyRef.current = null;
      return;
    }
    if (isLoading) return;
    const autoCreateKey = `${currentWorkspaceId}:${tabGroup}`;
    if (autoCreateKeyRef.current === autoCreateKey) return;
    autoCreateKeyRef.current = autoCreateKey;
    if (tabs.length === 0) {
      createTab('Analysis 1');
    }
  }, [currentWorkspaceId, tabGroup, isLoading, tabs.length, createTab]);

  // The workspace-level cleanup removes extra persisted tabs. Until that async
  // pass reconciles this group, single-tab mode displays the first tab instead
  // of an arbitrary previously-active tab.
  const singleTabModeActiveId =
    !analysisMultiTabEnabled && tabs.length > 0 ? (tabs[0]?.tab_id ?? null) : activeTabId;
  const activeTab = tabs.find((t) => t.tab_id === singleTabModeActiveId) ?? null;

  return (
    <AnalysisTabbedPanel
      tabs={tabs}
      activeTabId={activeTabId}
      onSelect={setActiveTab}
      onClose={closeTab}
      onCreate={() => createTab()}
      onRename={renameTab}
      onReorder={reorderTabs}
      multiTabEnabled={analysisMultiTabEnabled}
    >
      {activeTab ? (
        // key forces a fresh mount per tab so each tab hydrates its own task
        // (via tabTaskId) and keeps independent local panel state.
        <Feature
          key={activeTab.tab_id}
          host={{
            taskId: activeTab.task_id ?? null,
            inputSets: activeTab.input_sets,
            settings: activeTab.settings,
            setTaskId: (taskId) => {
              setTabTask(activeTab.tab_id, taskId);
            },
            setInputSet: (selectorId, inputs) => {
              setTabInputSet(activeTab.tab_id, selectorId, inputs);
            },
            setSetting: (key, value) => {
              setTabSetting(activeTab.tab_id, key, value);
            },
          }}
        />
      ) : null}
    </AnalysisTabbedPanel>
  );
}
