/**
 * Generic Chrome-style tabbed shell shared by every analysis view. It owns the
 * per-workspace tab group for a given analysis type and renders the active
 * tab's analysis panel beneath the protruding tab strip.
 *
 * Why this exists: the orchestration (load tab group → auto-create one tab →
 * draw the tab bar → mount the feature keyed by the active tab) is identical
 * across concordance, token-frequency, quotation, topic-modeling, and
 * sequential-analysis. Centralizing it here means every view shares exactly the
 * same tab UI and behaviour, and each per-view wrapper shrinks to a one-liner
 * that supplies only its tab-group namespace + panel component.
 *
 * Rendered by: the five ``*TabbedFeature`` wrappers (one per analysis view),
 * which ViewRouter lazy-loads. Each wrapper passes its own ``tabGroup`` and
 * ``Feature``.
 * Flow: resolve workspace + auth, load this workspace's tab group, auto-create
 * one empty tab when the group is empty, render the shared tab bar, then mount
 * ``Feature`` keyed by the active tab id so switching tabs gives each tab a
 * fresh, independently-hydrated panel instance.
 */
import { useEffect, type ComponentType } from 'react';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { AnalysisTabbedPanel } from './AnalysisTabbedPanel';
import { useWorkspaceTabs } from './useWorkspaceTabs';

/**
 * Tab props every analysis feature accepts so a tab can drive it. All optional
 * so a feature can still render standalone (e.g. in unit tests) without a tab.
 */
export interface AnalysisTabFeatureProps {
  tabId?: string;
  tabTaskId?: string | null;
  onTabTaskChange?: (taskId: string | null) => void;
}

export interface AnalysisTabsHostProps {
  /** Tab-group namespace; matches the backend analysis type for this view. */
  tabGroup: string;
  /** The single-analysis panel mounted for the active tab. */
  Feature: ComponentType<AnalysisTabFeatureProps>;
}

/**
 * Hosts one analysis view's tab strip and the active tab's panel.
 * Used by: the five ``*TabbedFeature`` wrappers because the tab bar and the
 * keyed feature panel both need the same live tab list, active id, and mutators.
 * Flow: read tab group → ensure a tab exists → render bar + keyed panel.
 */
export function AnalysisTabsHost({ tabGroup, Feature }: AnalysisTabsHostProps) {
  const { currentWorkspaceId } = useWorkspaceData();
  const { getAuthHeaders } = useAuth();

  const {
    tabs,
    activeTabId,
    isLoading,
    createTab,
    closeTab,
    renameTab,
    setActiveTab,
    setTabTask,
  } = useWorkspaceTabs(currentWorkspaceId, tabGroup, getAuthHeaders);

  // Requirement: entering an empty analysis view must present one ready tab so
  // the user can configure and run immediately. Gate on !isLoading so we don't
  // create a duplicate tab before the persisted group has hydrated.
  useEffect(() => {
    if (currentWorkspaceId && !isLoading && tabs.length === 0) {
      createTab('Analysis 1');
    }
  }, [currentWorkspaceId, isLoading, tabs.length, createTab]);

  const activeTab = tabs.find((t) => t.tab_id === activeTabId) ?? null;

  return (
    <AnalysisTabbedPanel
      tabs={tabs}
      activeTabId={activeTabId}
      onSelect={setActiveTab}
      onClose={closeTab}
      onCreate={() => createTab()}
      onRename={renameTab}
    >
      {activeTab ? (
        // key forces a fresh mount per tab so each tab hydrates its own task
        // (via tabTaskId) and keeps independent local panel state.
        <Feature
          key={activeTab.tab_id}
          tabId={activeTab.tab_id}
          tabTaskId={activeTab.task_id ?? null}
          onTabTaskChange={(taskId) => setTabTask(activeTab.tab_id, taskId)}
        />
      ) : null}
    </AnalysisTabbedPanel>
  );
}

export default AnalysisTabsHost;
