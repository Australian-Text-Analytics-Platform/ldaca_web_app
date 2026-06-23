import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as GeneratedSdk from '@/api/generated/sdk.gen';
import type { WorkspaceTabsState } from '@/api/generated/types.gen';
import { usePreferencesStore } from '@/stores/preferencesStore';
import { SettingsDialog } from '../SettingsDialog';

const mocks = vi.hoisted(() => ({
  getWorkspaceTabs: vi.fn(),
  useAuth: vi.fn(),
  useWorkspaceData: vi.fn(),
}));

vi.mock('@/api/generated/sdk.gen', async (importOriginal) => {
  const actual = await importOriginal<typeof GeneratedSdk>();
  return {
    ...actual,
    getWorkspaceTabs: mocks.getWorkspaceTabs,
  };
});

vi.mock('@/features/auth/hooks/useAuth', () => ({
  useAuth: mocks.useAuth,
}));

vi.mock('@/features/workspace/common/hooks/useWorkspaceData', () => ({
  useWorkspaceData: mocks.useWorkspaceData,
}));

type PreferenceTestState = Partial<ReturnType<typeof usePreferencesStore.getState>> & {
  analysisMultiTabEnabled: boolean;
};

/** Used by: SettingsDialog tests because each test needs a deterministic preferences store snapshot before rendering the dialog. */
function resetPreferenceState(analysisMultiTabEnabled = false) {
  usePreferencesStore.setState({
    hiddenViews: ['ai-annotator'],
    favoriteWorkspaces: [],
    defaultTokenizerModel: null,
    ldacaOniApiToken: null,
    analysisMultiTabEnabled,
    hydrated: true,
    syncing: false,
    lastSyncError: null,
  } as PreferenceTestState);
}

/** Creates an isolated query client for SettingsDialog tests that inspect workspace tab sidecar cache. */
function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

/** Renders SettingsDialog inside the query provider it uses to inspect tab sidecar state. */
function renderSettingsDialog(queryClient = makeQueryClient()) {
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <SettingsDialog open onOpenChange={vi.fn()} />
      </QueryClientProvider>,
    ),
  };
}

describe('SettingsDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPreferenceState();
    mocks.useAuth.mockReturnValue({
      dataFolder: '/tmp/ldaca-wordflow',
      getAuthHeaders: () => ({ Authorization: 'Bearer t' }),
      isMultiUserMode: false,
    });
    mocks.getWorkspaceTabs.mockResolvedValue({ data: { groups: {} } });
    mocks.useWorkspaceData.mockReturnValue({
      currentWorkspaceId: 'workspace-1',
      workspaces: [],
    });
  });

  it('shows the multi-tab toggle off by default and saves preference changes', async () => {
    const user = userEvent.setup();
    renderSettingsDialog();

    const multiTabToggle = screen.getByRole('switch', { name: /enable multi-tab/i });
    expect(multiTabToggle).not.toBeChecked();

    await user.click(multiTabToggle);

    expect(multiTabToggle).toBeChecked();
    expect(usePreferencesStore.getState().analysisMultiTabEnabled).toBe(true);
  });

  it('warns before disabling multi-tab when existing tabs would be deleted', async () => {
    resetPreferenceState(true);
    const user = userEvent.setup();
    const tabsState: WorkspaceTabsState = {
      groups: {
        concordance_analysis: {
          active_tab_id: 'tab-2',
          tabs: [
            { tab_id: 'tab-1', task_id: null, title: 'Analysis 1', inputs: [] },
            { tab_id: 'tab-2', task_id: 'task-2', title: 'Analysis 2', inputs: [] },
          ],
        },
      },
    };
    mocks.getWorkspaceTabs.mockResolvedValue({ data: tabsState });
    renderSettingsDialog();

    const multiTabToggle = screen.getByRole('switch', { name: /enable multi-tab/i });
    await user.click(multiTabToggle);

    expect(usePreferencesStore.getState().analysisMultiTabEnabled).toBe(true);
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText(/1 extra tab will be deleted/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /disable multi-tab/i }));

    expect(usePreferencesStore.getState().analysisMultiTabEnabled).toBe(false);
  });

  it('keeps multi-tab enabled when the destructive warning is cancelled', async () => {
    resetPreferenceState(true);
    const user = userEvent.setup();
    const tabsState: WorkspaceTabsState = {
      groups: {
        concordance_analysis: {
          active_tab_id: 'tab-2',
          tabs: [
            { tab_id: 'tab-1', task_id: null, title: 'Analysis 1', inputs: [] },
            { tab_id: 'tab-2', task_id: 'task-2', title: 'Analysis 2', inputs: [] },
          ],
        },
      },
    };
    mocks.getWorkspaceTabs.mockResolvedValue({ data: tabsState });
    renderSettingsDialog();

    await user.click(screen.getByRole('switch', { name: /enable multi-tab/i }));
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /keep multi-tab/i }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(usePreferencesStore.getState().analysisMultiTabEnabled).toBe(true);
  });

  it('disables multi-tab without warning when no extra tabs would be deleted', async () => {
    resetPreferenceState(true);
    const user = userEvent.setup();
    const tabsState: WorkspaceTabsState = {
      groups: {
        concordance_analysis: {
          active_tab_id: 'tab-1',
          tabs: [
            { tab_id: 'tab-1', task_id: null, title: 'Analysis 1', inputs: [] },
          ],
        },
      },
    };
    mocks.getWorkspaceTabs.mockResolvedValue({ data: tabsState });
    renderSettingsDialog();

    await user.click(screen.getByRole('switch', { name: /enable multi-tab/i }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(usePreferencesStore.getState().analysisMultiTabEnabled).toBe(false);
  });
});
