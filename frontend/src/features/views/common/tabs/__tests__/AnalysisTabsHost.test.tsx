import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AnalysisTab } from '@/api/generated/types.gen';
import { usePreferencesStore } from '@/stores/preferencesStore';
import { AnalysisTabsHost } from '../AnalysisTabsHost';
import type { UseWorkspaceTabsResult } from '../useWorkspaceTabs';

const mocks = vi.hoisted(() => ({
  useWorkspaceData: vi.fn(),
  useAuth: vi.fn(),
  useWorkspaceTabs: vi.fn(),
}));

vi.mock('@/features/workspace/common/hooks/useWorkspaceData', () => ({
  useWorkspaceData: mocks.useWorkspaceData,
}));

vi.mock('@/features/auth/hooks/useAuth', () => ({
  useAuth: mocks.useAuth,
}));

vi.mock('../useWorkspaceTabs', () => ({
  useWorkspaceTabs: mocks.useWorkspaceTabs,
}));

const tab: AnalysisTab = {
  tab_id: 'tab-1',
  task_id: null,
  title: 'Analysis 1',
  inputs: [],
};

const secondTab: AnalysisTab = {
  tab_id: 'tab-2',
  task_id: 'task-2',
  title: 'Analysis 2',
  inputs: [],
};

function makeTabsResult(
  overrides: Partial<UseWorkspaceTabsResult>,
): UseWorkspaceTabsResult {
  return {
    tabs: [],
    activeTabId: null,
    isLoading: false,
    createTab: vi.fn(() => 'new-tab'),
    closeTab: vi.fn(),
    renameTab: vi.fn(),
    setActiveTab: vi.fn(),
    reorderTabs: vi.fn(),
    setTabTask: vi.fn(),
    setTabInputs: vi.fn(),
    ...overrides,
  };
}

function Feature() {
  return <div>Feature panel</div>;
}

function FeatureWithTabId({ tabId }: { tabId?: string }) {
  return <div>Active tab {tabId}</div>;
}

type PreferenceTestState = Partial<ReturnType<typeof usePreferencesStore.getState>> & {
  analysisMultiTabEnabled: boolean;
};

function setMultiTabPreference(enabled: boolean) {
  usePreferencesStore.setState({
    analysisMultiTabEnabled: enabled,
  } as PreferenceTestState);
}

describe('AnalysisTabsHost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useWorkspaceData.mockReturnValue({ currentWorkspaceId: 'workspace-1' });
    mocks.useAuth.mockReturnValue({ getAuthHeaders: () => ({}) });
    setMultiTabPreference(false);
  });

  it('auto-creates one tab when entering an empty functional tab group', async () => {
    const createTab = vi.fn(() => 'new-tab');
    mocks.useWorkspaceTabs.mockReturnValue(makeTabsResult({ createTab }));

    const { rerender } = render(
      <AnalysisTabsHost tabGroup="token_frequencies" Feature={Feature} />,
    );

    await waitFor(() => { expect(createTab).toHaveBeenCalledWith('Analysis 1'); });
    expect(createTab).toHaveBeenCalledTimes(1);

    rerender(<AnalysisTabsHost tabGroup="token_frequencies" Feature={Feature} />);

    expect(createTab).toHaveBeenCalledTimes(1);
  });

  it('does not recreate a tab after the user closes the only tab', () => {
    const createTab = vi.fn(() => 'new-tab');
    let tabsResult = makeTabsResult({
      tabs: [tab],
      activeTabId: tab.tab_id,
      createTab,
    });
    mocks.useWorkspaceTabs.mockImplementation(() => tabsResult);

    const { rerender } = render(
      <AnalysisTabsHost tabGroup="token_frequencies" Feature={Feature} />,
    );

    expect(createTab).not.toHaveBeenCalled();

    tabsResult = makeTabsResult({ createTab });
    rerender(<AnalysisTabsHost tabGroup="token_frequencies" Feature={Feature} />);

    expect(createTab).not.toHaveBeenCalled();
  });

  it('hides multi-tab chrome by default while still rendering the active feature', () => {
    mocks.useWorkspaceTabs.mockReturnValue(makeTabsResult({
      tabs: [tab],
      activeTabId: tab.tab_id,
    }));

    render(<AnalysisTabsHost tabGroup="token_frequencies" Feature={Feature} />);

    expect(screen.queryByRole('tablist', { name: /analysis tabs/i })).not.toBeInTheDocument();
    expect(screen.getByText('Feature panel')).toBeInTheDocument();
  });

  it('shows multi-tab chrome when the preference is enabled', () => {
    setMultiTabPreference(true);
    mocks.useWorkspaceTabs.mockReturnValue(makeTabsResult({
      tabs: [tab],
      activeTabId: tab.tab_id,
    }));

    render(<AnalysisTabsHost tabGroup="token_frequencies" Feature={Feature} />);

    expect(screen.getByRole('tablist', { name: /analysis tabs/i })).toBeInTheDocument();
    expect(screen.getByRole('tab')).toHaveTextContent('Analysis 1');
  });

  it('renders the first tab while single-tab cleanup is pending', () => {
    mocks.useWorkspaceTabs.mockReturnValue(makeTabsResult({
      tabs: [tab, secondTab],
      activeTabId: secondTab.tab_id,
    }));

    render(<AnalysisTabsHost tabGroup="token_frequencies" Feature={FeatureWithTabId} />);

    expect(screen.getByText('Active tab tab-1')).toBeInTheDocument();
  });
});
