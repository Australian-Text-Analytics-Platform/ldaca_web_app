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
 * when the preference enables it or the group has multiple tabs, then mount ``Feature`` keyed by the
 * active tab id so switching tabs gives each tab a fresh, independently-hydrated
 * panel instance. The preference is presentation-only: it never changes tab
 * ownership or persisted state.
 */
import { useEffect, useRef, type ComponentType } from 'react';
import type { Analysis, TopicModelingClusterSelection } from '@/api';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import { useUserPreferences } from '@/features/preferences/useUserPreferences';
import { useTabAnalysisForest } from '../hooks/useTabAnalysisForest';
import { AnalysisTabbedPanel } from './AnalysisTabbedPanel';
import type { AnalysisTabInput, AnalysisTabInputSets } from './tabStateOps';
import { useWorkspaceTabs } from './useWorkspaceTabs';

/**
 * Canonical owner passed to every analysis feature. Values are normalized at
 * this boundary and persistence commands already capture the active tab id, so
 * feature code never branches on whether it happens to be tab-mounted.
 */
interface AnalysisFeatureHost {
  tabId: string;
  analyses: Analysis[];
  latestPreview: Analysis | null;
  latestRunAll: Analysis | null;
  activeAnalysis: Analysis | null;
  inputSets: AnalysisTabInputSets;
  settings: Record<string, string>;
  correctionColumns: Record<string, string>;
  stopWords: string[];
  topicModelingWordsPerTopic: number | null;
  topicModelingClusterSelection: TopicModelingClusterSelection | null;
  setInputSet: (selectorId: string, inputs: AnalysisTabInput[]) => void;
  setSetting: (key: string, value: string) => void;
  setCorrectionColumn: (nodeId: string, column: string | null) => Promise<void>;
  clearCorrectionColumns: () => Promise<void>;
  setPresentationSettings: (patch: {
    stop_words?: string[];
    topic_modeling_words_per_topic?: number | null;
    topic_modeling_cluster_selection?: TopicModelingClusterSelection | null;
  }) => Promise<void>;
  refreshAnalyses: () => void;
}

export interface AnalysisTabFeatureProps {
  host: AnalysisFeatureHost;
}

export interface AnalysisTabsHostProps {
  /** Tab-group namespace; matches the backend analysis type for this view. */
  tabGroup: string;
  /** The single-analysis panel mounted for the active tab. */
  Feature: ComponentType<AnalysisTabFeatureProps>;
  /** A cross-view handoff may target a newly created tab before this host mounts. */
  preferredTabId?: string | null;
}

/**
 * Hosts one analysis view's tab strip and the active tab's panel.
 * Used by: viewComponents' tabbed feature loaders because the tab bar and the
 * keyed feature panel both need the same live tab list, active id, and mutators.
 * Flow: read tab group → ensure a tab exists → render optional bar + keyed panel.
 */
export function AnalysisTabsHost({
  tabGroup,
  Feature,
  preferredTabId = null,
}: AnalysisTabsHostProps) {
  const { currentWorkspaceId } = useWorkspaceData();
  const { preferences } = useUserPreferences();
  const analysisMultiTabEnabled = preferences.analysis_multi_tab_enabled ?? false;
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
    setTabInputSet,
    setTabSetting,
    setAnnotationCorrectionColumn,
    clearAnnotationCorrectionColumns,
    setPresentationSettings,
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
      void createTab('Analysis 1');
    }
  }, [currentWorkspaceId, tabGroup, isLoading, tabs.length, createTab]);

  useEffect(() => {
    if (
      preferredTabId &&
      preferredTabId !== activeTabId &&
      tabs.some((tab) => tab.tab_id === preferredTabId)
    ) {
      setActiveTab(preferredTabId);
    }
  }, [activeTabId, preferredTabId, setActiveTab, tabs]);

  // Disabled mode hides chrome only for the ordinary one-tab case. Programmatic
  // flows may still create additional tabs, which must immediately reveal the
  // complete tab UI so every persisted tab stays reachable.
  const showTabChrome = analysisMultiTabEnabled || tabs.length > 1;
  const preferredTab = preferredTabId
    ? (tabs.find((tab) => tab.tab_id === preferredTabId) ?? null)
    : null;
  const effectiveActiveTabId = preferredTab?.tab_id ?? activeTabId;
  const activeTab = preferredTab ?? tabs.find((tab) => tab.tab_id === activeTabId) ?? null;
  const analysisForest = useTabAnalysisForest(
    activeTab ? (currentWorkspaceId ?? null) : null,
    activeTab?.tab_id ?? '__inactive__',
  );

  return (
    <AnalysisTabbedPanel
      tabs={tabs}
      activeTabId={effectiveActiveTabId}
      onSelect={setActiveTab}
      onClose={closeTab}
      onCreate={() => {
        void createTab();
      }}
      onRename={renameTab}
      onReorder={reorderTabs}
      multiTabEnabled={showTabChrome}
    >
      {activeTab ? (
        // Key forces a fresh mount per Tab so transient drafts are discarded
        // when the user leaves it. Durable Analyses hydrate from Query state.
        <Feature
          key={activeTab.tab_id}
          host={{
            tabId: activeTab.tab_id,
            analyses: analysisForest.analyses,
            latestPreview: analysisForest.latestPreview,
            latestRunAll: analysisForest.latestRunAll,
            activeAnalysis: analysisForest.active,
            inputSets: activeTab.input_sets,
            settings: activeTab.settings,
            correctionColumns: activeTab.annotation_correction_columns,
            stopWords: activeTab.stop_words,
            topicModelingWordsPerTopic: activeTab.topic_modeling_words_per_topic,
            topicModelingClusterSelection: activeTab.topic_modeling_cluster_selection,
            setInputSet: (selectorId, inputs) => {
              setTabInputSet(activeTab.tab_id, selectorId, inputs);
            },
            setSetting: (key, value) => {
              setTabSetting(activeTab.tab_id, key, value);
            },
            setCorrectionColumn: (nodeId, column) => {
              return setAnnotationCorrectionColumn(activeTab.tab_id, nodeId, column);
            },
            clearCorrectionColumns: () => {
              return clearAnnotationCorrectionColumns(activeTab.tab_id);
            },
            setPresentationSettings: (patch) => {
              return setPresentationSettings(activeTab.tab_id, patch);
            },
            refreshAnalyses: () => {
              analysisForest.refresh();
            },
          }}
        />
      ) : null}
    </AnalysisTabbedPanel>
  );
}
