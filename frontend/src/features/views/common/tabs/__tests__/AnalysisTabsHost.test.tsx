import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AnalysisTab } from '@/api';
import { AnalysisTabsHost, type AnalysisTabFeatureProps } from '../AnalysisTabsHost';
import type { UseWorkspaceTabsResult } from '../useWorkspaceTabs';

const mocks = vi.hoisted(() => ({
  useWorkspaceData: vi.fn(),
  useAuth: vi.fn(),
  useWorkspaceTabs: vi.fn(),
  multiTabEnabled: false,
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

vi.mock('@/features/preferences/useUserPreferences', () => ({
  useUserPreferences: () => ({
    preferences: { analysis_multi_tab_enabled: mocks.multiTabEnabled },
  }),
}));

const tab: AnalysisTab = {
  tab_id: 'tab-1',
  task_id: null,
  title: 'Analysis 1',
  input_sets: { source: [] },
  settings: {},
};

const secondTab: AnalysisTab = {
  tab_id: 'tab-2',
  task_id: 'task-2',
  title: 'Analysis 2',
  input_sets: { source: [] },
  settings: {},
};

function makeTabsResult(overrides: Partial<UseWorkspaceTabsResult>): UseWorkspaceTabsResult {
  return {
    tabs: [],
    activeTabId: null,
    isLoading: false,
    createTab: vi.fn(async () => null),
    closeTab: vi.fn(),
    renameTab: vi.fn(),
    setActiveTab: vi.fn(),
    reorderTabs: vi.fn(),
    setTabTask: vi.fn(),
    setTabInputSet: vi.fn(),
    setTabSetting: vi.fn(),
    ...overrides,
  };
}

function Feature() {
  return <div>Feature panel</div>;
}

function FeatureWithTask({ host }: AnalysisTabFeatureProps) {
  return <div>Active task {host.taskId ?? 'none'}</div>;
}

function FeatureCommands({ host }: AnalysisTabFeatureProps) {
  return (
    <div>
      <span>Inputs {String(host.inputSets.source?.length ?? 0)}</span>
      <span>Setting {host.settings.mode}</span>
      <button
        type="button"
        onClick={() => {
          host.setTaskId('task-next');
        }}
      >
        Save task
      </button>
      <button
        type="button"
        onClick={() => {
          host.setInputSet('source', [{ node_id: 'node-next', column: 'text' }]);
        }}
      >
        Save input
      </button>
      <button
        type="button"
        onClick={() => {
          host.setSetting('mode', 'ai');
        }}
      >
        Save setting
      </button>
    </div>
  );
}

function setMultiTabPreference(enabled: boolean) {
  mocks.multiTabEnabled = enabled;
}

describe('AnalysisTabsHost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useWorkspaceData.mockReturnValue({ currentWorkspaceId: 'workspace-1' });
    mocks.useAuth.mockReturnValue({});
    setMultiTabPreference(false);
  });

  it('auto-creates one tab when entering an empty functional tab group', async () => {
    const createTab = vi.fn(async () => null);
    mocks.useWorkspaceTabs.mockReturnValue(makeTabsResult({ createTab }));

    const { rerender } = render(
      <AnalysisTabsHost tabGroup="token_frequencies" Feature={Feature} />,
    );

    await waitFor(() => {
      expect(createTab).toHaveBeenCalledWith('Analysis 1');
    });
    expect(createTab).toHaveBeenCalledTimes(1);

    rerender(<AnalysisTabsHost tabGroup="token_frequencies" Feature={Feature} />);

    expect(createTab).toHaveBeenCalledTimes(1);
  });

  it('does not recreate a tab after the user closes the only tab', () => {
    const createTab = vi.fn(async () => null);
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
    mocks.useWorkspaceTabs.mockReturnValue(
      makeTabsResult({
        tabs: [tab],
        activeTabId: tab.tab_id,
      }),
    );

    render(<AnalysisTabsHost tabGroup="token_frequencies" Feature={Feature} />);

    expect(screen.queryByRole('tablist', { name: /analysis tabs/i })).not.toBeInTheDocument();
    expect(screen.getByText('Feature panel')).toBeInTheDocument();
  });

  it('shows multi-tab chrome when the preference is enabled', () => {
    setMultiTabPreference(true);
    mocks.useWorkspaceTabs.mockReturnValue(
      makeTabsResult({
        tabs: [tab],
        activeTabId: tab.tab_id,
      }),
    );

    render(<AnalysisTabsHost tabGroup="token_frequencies" Feature={Feature} />);

    expect(screen.getByRole('tablist', { name: /analysis tabs/i })).toBeInTheDocument();
    expect(screen.getByRole('tab')).toHaveTextContent('Analysis 1');
  });

  it('shows multi-tab chrome and preserves the active tab when disabled mode has multiple tabs', () => {
    mocks.useWorkspaceTabs.mockReturnValue(
      makeTabsResult({
        tabs: [tab, secondTab],
        activeTabId: secondTab.tab_id,
      }),
    );

    render(<AnalysisTabsHost tabGroup="token_frequencies" Feature={FeatureWithTask} />);

    expect(screen.getByRole('tablist', { name: /analysis tabs/i })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(screen.getByRole('button', { name: /new tab/i })).toBeInTheDocument();
    expect(screen.getByText('Active task task-2')).toBeInTheDocument();
  });

  it('renders and activates a tab targeted by a cross-view handoff', async () => {
    const setActiveTab = vi.fn();
    mocks.useWorkspaceTabs.mockReturnValue(
      makeTabsResult({
        tabs: [tab, secondTab],
        activeTabId: tab.tab_id,
        setActiveTab,
      }),
    );

    render(
      <AnalysisTabsHost
        tabGroup="concordance"
        Feature={FeatureWithTask}
        preferredTabId={secondTab.tab_id}
      />,
    );

    expect(screen.getByText('Active task task-2')).toBeInTheDocument();
    await waitFor(() => {
      expect(setActiveTab).toHaveBeenCalledWith(secondTab.tab_id);
    });
  });

  it('binds required feature commands to the active persisted tab', () => {
    const setTabTask = vi.fn();
    const setTabInputSet = vi.fn();
    const setTabSetting = vi.fn();
    mocks.useWorkspaceTabs.mockReturnValue(
      makeTabsResult({
        tabs: [{ ...tab, settings: { mode: 'manual' } }],
        activeTabId: tab.tab_id,
        setTabTask,
        setTabInputSet,
        setTabSetting,
      }),
    );

    render(<AnalysisTabsHost tabGroup="annotation" Feature={FeatureCommands} />);

    expect(screen.getByText('Inputs 0')).toBeInTheDocument();
    expect(screen.getByText('Setting manual')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save task' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save input' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save setting' }));

    expect(setTabTask).toHaveBeenCalledWith('tab-1', 'task-next');
    expect(setTabInputSet).toHaveBeenCalledWith('tab-1', 'source', [
      { node_id: 'node-next', column: 'text' },
    ]);
    expect(setTabSetting).toHaveBeenCalledWith('tab-1', 'mode', 'ai');
  });
});
