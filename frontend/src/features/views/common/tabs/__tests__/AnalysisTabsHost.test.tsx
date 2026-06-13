import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AnalysisTab } from '@/api/generated/types.gen';
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

describe('AnalysisTabsHost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useWorkspaceData.mockReturnValue({ currentWorkspaceId: 'workspace-1' });
    mocks.useAuth.mockReturnValue({ getAuthHeaders: () => ({}) });
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
});