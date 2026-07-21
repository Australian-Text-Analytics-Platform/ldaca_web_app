import { beforeEach, describe, expect, it } from 'vitest';

import {
  analysisTabsPresentationKey,
  useAnalysisTabsPresentationStore,
} from '../analysisTabsPresentationStore';

describe('analysisTabsPresentationStore', () => {
  beforeEach(() => {
    useAnalysisTabsPresentationStore.setState({ activeTabIds: {} });
    localStorage.removeItem('ldaca-analysis-active-tabs');
  });

  it('keeps active tabs independent by Workspace and analysis kind', () => {
    const { rememberActiveTab } = useAnalysisTabsPresentationStore.getState();

    rememberActiveTab('workspace-1', 'concordance', 'concordance-tab');
    rememberActiveTab('workspace-1', 'token_frequency', 'frequency-tab');
    rememberActiveTab('workspace-2', 'concordance', 'other-workspace-tab');

    expect(useAnalysisTabsPresentationStore.getState().activeTabIds).toEqual({
      [analysisTabsPresentationKey('workspace-1', 'concordance')]: 'concordance-tab',
      [analysisTabsPresentationKey('workspace-1', 'token_frequency')]: 'frequency-tab',
      [analysisTabsPresentationKey('workspace-2', 'concordance')]: 'other-workspace-tab',
    });
  });

  it('removes a remembered tab when no valid fallback remains', () => {
    const { rememberActiveTab } = useAnalysisTabsPresentationStore.getState();
    const key = analysisTabsPresentationKey('workspace-1', 'concordance');

    rememberActiveTab('workspace-1', 'concordance', 'tab-1');
    rememberActiveTab('workspace-1', 'concordance', null);

    expect(useAnalysisTabsPresentationStore.getState().activeTabIds[key]).toBeUndefined();
  });

  it('persists the active tab in client-local storage', () => {
    const key = analysisTabsPresentationKey('workspace-1', 'token_frequency');

    useAnalysisTabsPresentationStore
      .getState()
      .rememberActiveTab('workspace-1', 'token_frequency', 'tab-2');

    expect(JSON.parse(localStorage.getItem('ldaca-analysis-active-tabs') ?? '{}')).toMatchObject({
      state: { activeTabIds: { [key]: 'tab-2' } },
    });
  });
});
