import { beforeEach, describe, expect, it } from 'vitest';

import {
  analysisTabSettingsKey,
  analysisTabsPresentationKey,
  useAnalysisTabsPresentationStore,
} from '../analysisTabsPresentationStore';

describe('analysisTabsPresentationStore', () => {
  beforeEach(() => {
    useAnalysisTabsPresentationStore.setState({ activeTabIds: {}, tabSettings: {} });
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
      JSON.parse(localStorage.getItem('ldaca-analysis-tab-presentation-v3') ?? '{}'),
    ).toMatchObject({
      state: { activeTabIds: { [key]: 'tab-2' } },
    });
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
