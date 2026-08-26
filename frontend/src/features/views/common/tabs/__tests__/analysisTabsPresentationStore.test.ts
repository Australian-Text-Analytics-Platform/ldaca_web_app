import { beforeEach, describe, expect, it } from 'vitest';

import {
  ANALYSIS_TABS_PRESENTATION_STORAGE_KEY,
  analysisTabSettingsKey,
  analysisTabsPresentationKey,
  migrateAnalysisTabsPresentationV3,
  useAnalysisTabsPresentationStore,
} from '../analysisTabsPresentationStore';
import { ANNOTATION_TAB_SETTINGS_KEY } from '@/features/views/annotation/annotationTabSettings';

describe('analysisTabsPresentationStore', () => {
  beforeEach(() => {
    useAnalysisTabsPresentationStore.setState({ activeTabIds: {}, tabSettings: {} });
    localStorage.removeItem(ANALYSIS_TABS_PRESENTATION_STORAGE_KEY);
    localStorage.removeItem('ldaca-analysis-tab-presentation-v3');
  });

  it('keeps active tabs independent by user, Workspace, and analysis kind', () => {
    const { rememberActiveTab } = useAnalysisTabsPresentationStore.getState();

    rememberActiveTab('user-1', 'workspace-1', 'concordance', 'concordance-tab');
    rememberActiveTab('user-1', 'workspace-1', 'token_frequency', 'frequency-tab');
    rememberActiveTab('user-2', 'workspace-1', 'concordance', 'other-user-tab');

    expect(useAnalysisTabsPresentationStore.getState().activeTabIds).toEqual({
      [analysisTabsPresentationKey('user-1', 'workspace-1', 'concordance')]: 'concordance-tab',
      [analysisTabsPresentationKey('user-1', 'workspace-1', 'token_frequency')]: 'frequency-tab',
      [analysisTabsPresentationKey('user-2', 'workspace-1', 'concordance')]: 'other-user-tab',
    });
  });

  it('removes a remembered tab when no valid fallback remains', () => {
    const { rememberActiveTab } = useAnalysisTabsPresentationStore.getState();
    const key = analysisTabsPresentationKey('user-1', 'workspace-1', 'concordance');

    rememberActiveTab('user-1', 'workspace-1', 'concordance', 'tab-1');
    rememberActiveTab('user-1', 'workspace-1', 'concordance', null);

    expect(useAnalysisTabsPresentationStore.getState().activeTabIds[key]).toBeUndefined();
  });

  it('persists the active tab in client-local storage', () => {
    const key = analysisTabsPresentationKey('user-1', 'workspace-1', 'token_frequency');

    useAnalysisTabsPresentationStore
      .getState()
      .rememberActiveTab('user-1', 'workspace-1', 'token_frequency', 'tab-2');

    expect(
      JSON.parse(localStorage.getItem(ANALYSIS_TABS_PRESENTATION_STORAGE_KEY) ?? '{}'),
    ).toMatchObject({
      state: { activeTabIds: { [key]: 'tab-2' } },
    });
  });

  it('migrates v3 Annotation keys into one v4 record', () => {
    const settingsKey = analysisTabSettingsKey('user-1', 'workspace-1', 'tab-1');
    localStorage.setItem(
      'ldaca-analysis-tab-presentation-v3',
      JSON.stringify({
        state: {
          activeTabIds: {},
          tabSettings: {
            [settingsKey]: {
              annotationMode: 'ai',
              annotationTargets: JSON.stringify({ 'node-1': 'annotation' }),
              contextLength: '12',
            },
          },
        },
        version: 3,
      }),
    );

    migrateAnalysisTabsPresentationV3(localStorage);

    const persisted = JSON.parse(
      localStorage.getItem(ANALYSIS_TABS_PRESENTATION_STORAGE_KEY) ?? '{}',
    );
    const migrated = persisted.state.tabSettings[settingsKey];
    expect(persisted.version).toBe(4);
    expect(migrated.contextLength).toBe('12');
    expect(JSON.parse(migrated[ANNOTATION_TAB_SETTINGS_KEY])).toMatchObject({
      annotationMode: 'ai',
      annotationTargets: { 'node-1': 'annotation' },
    });
    expect(migrated.annotationMode).toBeUndefined();
    expect(localStorage.getItem('ldaca-analysis-tab-presentation-v3')).toBeNull();
  });

  it('stores presentation settings per user, Workspace, and Tab', () => {
    const { rememberTabSetting } = useAnalysisTabsPresentationStore.getState();
    rememberTabSetting('user-1', 'workspace-1', 'tab-1', 'contextLength', '12');
    rememberTabSetting('user-2', 'workspace-1', 'tab-1', 'contextLength', '24');

    expect(useAnalysisTabsPresentationStore.getState().tabSettings).toEqual({
      [analysisTabSettingsKey('user-1', 'workspace-1', 'tab-1')]: { contextLength: '12' },
      [analysisTabSettingsKey('user-2', 'workspace-1', 'tab-1')]: { contextLength: '24' },
    });
  });
});
