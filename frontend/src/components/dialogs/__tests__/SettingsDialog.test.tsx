import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsDialog } from '../SettingsDialog';

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(),
  useWorkspaceData: vi.fn(),
  multiTabEnabled: false,
  updatePreferences: vi.fn(),
}));

vi.mock('@/lib/isTauri', () => ({
  isTauri: mocks.isTauri,
}));

vi.mock('@/features/workspace/common/hooks/useWorkspaceData', () => ({
  useWorkspaceData: mocks.useWorkspaceData,
}));

vi.mock('@/features/auth/hooks/useAuth', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    isMultiUserMode: false,
    user: { id: 'root' },
  }),
}));

vi.mock('@/features/preferences/useUserPreferences', () => ({
  useUserPreferences: () => ({
    preferences: {
      hidden_views: [],
      favorite_workspaces: [],
      analysis_multi_tab_enabled: mocks.multiTabEnabled,
      contextual_hints_enabled: true,
    },
  }),
  useUpdateUserPreferences: () => ({ mutate: mocks.updatePreferences }),
}));

/** Resets the preferences store to a deterministic snapshot before rendering. */
function resetPreferenceState(analysisMultiTabEnabled = false) {
  mocks.multiTabEnabled = analysisMultiTabEnabled;
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
    mocks.isTauri.mockReturnValue(false);
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

    expect(mocks.updatePreferences).toHaveBeenCalledWith({
      analysis_multi_tab_enabled: true,
    });
  });

  it('disables multi-tab directly without inspecting or deleting existing tabs', async () => {
    resetPreferenceState(true);
    const user = userEvent.setup();
    renderSettingsDialog();

    const multiTabToggle = screen.getByRole('switch', { name: /enable multi-tab/i });
    await user.click(multiTabToggle);

    expect(mocks.updatePreferences).toHaveBeenCalledWith({
      analysis_multi_tab_enabled: false,
    });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('keeps the working directory server-owned outside Tauri', async () => {
    const user = userEvent.setup();
    renderSettingsDialog();

    await user.click(screen.getByRole('tab', { name: 'Workspace' }));

    expect(screen.getByText('Managed by server')).toBeInTheDocument();
    expect(screen.queryByLabelText('Path')).not.toBeInTheDocument();
  });

  it('renders the AI providers panel in the AI tab', async () => {
    const user = userEvent.setup();
    renderSettingsDialog();

    await user.click(screen.getByRole('tab', { name: 'AI' }));

    expect(await screen.findByText('AI provider credentials')).toBeInTheDocument();
    expect(screen.getByText('OpenRouter')).toBeInTheDocument();
    expect(screen.getAllByText('Not configured').length).toBeGreaterThan(0);
  });
});
