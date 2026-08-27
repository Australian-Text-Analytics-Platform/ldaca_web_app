import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsDialog } from '../SettingsDialog';
import { DataRootContext } from '@/features/bootstrap/DataRootContext';

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(),
  useWorkspaceData: vi.fn(),
  multiTabEnabled: false,
  updatePreferences: vi.fn(),
  preferencesReady: true,
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
      color_theme: 'light-2026',
    },
    isError: false,
    isSuccess: mocks.preferencesReady,
    refetch: vi.fn(),
  }),
  useUpdateUserPreferences: () => ({ mutate: mocks.updatePreferences, isPending: false }),
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
        <DataRootContext.Provider
          value={{
            resource: {
              state: 'ready',
              source: 'config',
              data_root: '/srv/wordflow',
              suggested_data_root: '/srv/recommended',
              mutable: true,
              runtime_generation: 1,
              error: null,
              change_token: 'token',
            },
            configureDataRoot: vi.fn(),
          }}
        >
          <SettingsDialog open onOpenChange={vi.fn()} />
        </DataRootContext.Provider>
      </QueryClientProvider>,
    ),
  };
}

describe('SettingsDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPreferenceState();
    mocks.isTauri.mockReturnValue(false);
    mocks.preferencesReady = true;
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

  it('switches themes optimistically and rolls the runtime back when saving fails', async () => {
    const { applyColorTheme, getActiveTheme } = await import('@/features/theme/themeRuntime');
    applyColorTheme('light-2026');
    const user = userEvent.setup();
    renderSettingsDialog();

    await user.click(screen.getByRole('switch', { name: 'Use Dark 2026 theme' }));

    expect(getActiveTheme()).toBe('dark-2026');
    expect(mocks.updatePreferences).toHaveBeenCalledWith(
      { color_theme: 'dark-2026' },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
    const mutationOptions = mocks.updatePreferences.mock.calls.at(-1)?.[1] as
      | { onError?: () => void }
      | undefined;
    mutationOptions?.onError?.();
    expect(getActiveTheme()).toBe('light-2026');
  });

  it('disables the appearance switch until account preferences resolve', () => {
    mocks.preferencesReady = false;
    renderSettingsDialog();

    expect(screen.getByRole('switch', { name: 'Use Dark 2026 theme' })).toBeDisabled();
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

  it('offers the backend-owned server path outside Tauri', async () => {
    const user = userEvent.setup();
    renderSettingsDialog();

    await user.click(screen.getByRole('tab', { name: 'Workspace' }));

    expect(screen.getByLabelText('Folder on the server')).toHaveValue('/srv/wordflow');
  });

  it('renders the AI providers panel in the AI tab', async () => {
    const user = userEvent.setup();
    renderSettingsDialog();

    await user.click(screen.getByRole('tab', { name: 'AI' }));

    expect(await screen.findByText('Annotation providers')).toBeInTheDocument();
    expect(screen.getByText('No Annotation providers configured.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Provider' })).toBeInTheDocument();
  });

  it('does not duplicate native update controls in Settings', () => {
    const view = renderSettingsDialog();

    expect(screen.queryByRole('tab', { name: 'Updates' })).not.toBeInTheDocument();
    view.unmount();

    mocks.isTauri.mockReturnValue(true);
    renderSettingsDialog();
    expect(screen.queryByRole('tab', { name: 'Updates' })).not.toBeInTheDocument();
  });
});
