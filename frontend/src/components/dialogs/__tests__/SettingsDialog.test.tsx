import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as GeneratedSdk from '@/api';
import { usePreferencesStore } from '@/stores/preferencesStore';
import { SettingsDialog } from '../SettingsDialog';

const mocks = vi.hoisted(() => ({
  getWorkspaceTabs: vi.fn(),
  useAuth: vi.fn(),
  useWorkspaceData: vi.fn(),
}));

vi.mock('@/api', async (importOriginal) => {
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

/** Resets the preferences store to a deterministic snapshot before rendering. */
function resetPreferenceState(analysisMultiTabEnabled = false) {
  usePreferencesStore.setState({
    hiddenViews: [],
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

  it('disables multi-tab directly without inspecting or deleting existing tabs', async () => {
    resetPreferenceState(true);
    const user = userEvent.setup();
    renderSettingsDialog();

    const multiTabToggle = screen.getByRole('switch', { name: /enable multi-tab/i });
    await user.click(multiTabToggle);

    expect(usePreferencesStore.getState().analysisMultiTabEnabled).toBe(false);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(mocks.getWorkspaceTabs).not.toHaveBeenCalled();
  });

  it('renders the AI providers panel in the AI tab', async () => {
    const user = userEvent.setup();
    renderSettingsDialog();

    await user.click(screen.getByRole('tab', { name: 'AI' }));

    expect(await screen.findByText('AI Providers')).toBeInTheDocument();
    expect(screen.getByText('OpenRouter')).toBeInTheDocument();
    expect(screen.getByText('Custom Providers')).toBeInTheDocument();
  });
});
