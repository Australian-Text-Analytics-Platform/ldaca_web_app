import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import Sidebar from '../Sidebar';
import { SidebarProvider } from '../../ui/sidebar';
import { useUIStore } from '@/stores/uiStore';
import { useGuidanceAcknowledgmentsStore } from '@/features/guidance/acknowledgmentsStore';

/** Toast spy used to verify sidebar menu actions surface user feedback. */
const toastMock = vi.fn();
const preferenceFixture = vi.hoisted(() => ({
  hiddenViews: [] as string[],
  mutate: vi.fn(),
}));

vi.mock('sonner', () => ({
  /** Used by: sidebar menu tests to assert toast feedback. */
  toast: (...args: unknown[]) => toastMock(...args),
}));

/**
 * Mutable auth fixture consumed by the mocked `useAuth` hook across sidebar visibility tests.
 */
const authState = {
  user: { id: 'user-1', name: 'Test User' },
  logout: vi.fn(),
  isMultiUserMode: false,
};

vi.mock('@/features/workspace/common/hooks/useWorkspaceData', () => ({
  /** Used by: Sidebar tests to provide an empty workspace graph fixture. */
  useWorkspaceData: () => ({
    workspaces: [],
    workspaceGraph: { nodes: [] },
    currentWorkspaceId: 'ws-1',
  }),
}));

vi.mock('@/features/workspace/common/hooks/useWorkspaceSelection', () => ({
  /** Used by: Sidebar tests to keep node-selection state empty. */
  useWorkspaceSelection: () => ({
    selectedNodeIds: [],
  }),
}));

vi.mock('@/features/workspace/common/hooks/useWorkspaceActions', () => ({
  /** Used by: Sidebar tests to stub child component workspace actions. */
  useWorkspaceActions: () => ({
    toggleNode: vi.fn(),
    setCurrentWorkspace: vi.fn(),
  }),
}));

vi.mock('@/features/workspace/task-stream/useWorkspaceTaskInbox', () => ({
  /** Used by: Sidebar tests to provide a quiet task-stream fixture. */
  useWorkspaceTaskInbox: () => ({
    status: 'closed',
    error: null,
    tasks: [],
    reconnect: vi.fn(),
  }),
}));

vi.mock('@/features/auth/hooks/useAuth', () => ({
  /**
   * Returns the mutable auth fixture used by sidebar account and action controls.
   */
  useAuth: () => authState,
}));

vi.mock('@/features/preferences/useUserPreferences', () => ({
  useUserPreferences: () => ({
    preferences: {
      hidden_views: preferenceFixture.hiddenViews,
      favorite_workspaces: [],
      default_tokenizer_model: null,
      analysis_multi_tab_enabled: false,
      contextual_hints_enabled: true,
    },
  }),
  useUpdateUserPreferences: () => ({ mutate: preferenceFixture.mutate }),
}));

/** Called by: Sidebar view-visibility tests before querying menu behavior. */
const renderSidebar = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <SidebarProvider>
        <Sidebar />
      </SidebarProvider>
    </QueryClientProvider>,
  );
};

describe('Sidebar view visibility menu', () => {
  beforeEach(() => {
    authState.isMultiUserMode = false;
    authState.logout = vi.fn();

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    window.localStorage.clear();
    useUIStore.setState((state) => ({
      ...state,
      currentView: 'data-loader',
      loadingOperations: new Set(),
      feedbackOpen: false,
      documentTarget: null,
    }));
    preferenceFixture.hiddenViews = [];
    preferenceFixture.mutate.mockReset();
    useGuidanceAcknowledgmentsStore.setState({ byUser: {} });
    toastMock.mockReset();
  });

  it('allows hiding and showing optional views from the views editor', async () => {
    const user = userEvent.setup();

    const view = renderSidebar();

    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Data Loader' })).toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: /edit visible views/i })[0]!);

    const exportToggle = screen.getByRole('menuitemcheckbox', { name: 'Export' });
    expect(exportToggle).toBeChecked();

    await user.click(exportToggle);
    expect(preferenceFixture.mutate).toHaveBeenCalledWith({
      hidden_views: ['export'],
    });

    view.unmount();
    preferenceFixture.hiddenViews = ['export'];
    preferenceFixture.mutate.mockClear();
    renderSidebar();
    await user.click(screen.getAllByRole('button', { name: /edit visible views/i })[0]!);
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Export' }));
    expect(preferenceFixture.mutate).toHaveBeenCalledWith({ hidden_views: [] });
  });

  it('keeps Data Loader out of the views editor so it always remains visible', async () => {
    const user = userEvent.setup();

    renderSidebar();

    await user.click(screen.getAllByRole('button', { name: /edit visible views/i })[0]!);

    expect(screen.queryByRole('menuitemcheckbox', { name: 'Data Loader' })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitemcheckbox', { name: 'Preprocessing' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.getAllByRole('button', { name: 'Data Loader' }).length).toBeGreaterThan(0);
  });

  it('opens Settings from the header cog and resets Contextual Hint history there', async () => {
    const user = userEvent.setup();

    useGuidanceAcknowledgmentsStore.setState({
      byUser: { 'user-1': { 'preprocessing.filter.select-node': 1 } },
    });

    renderSidebar();

    await user.click(screen.getByRole('button', { name: /open settings/i }));
    expect(
      await screen.findByRole('dialog', { name: 'Settings' }, { timeout: 5_000 }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /quotation/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /guidance/i }));
    await user.click(screen.getByRole('button', { name: /reset contextual hint history/i }));

    expect(useGuidanceAcknowledgmentsStore.getState().byUser['user-1']).toBeUndefined();
    expect(toastMock).toHaveBeenCalledWith(
      'Contextual Hint history reset. Eligible hints can appear again.',
    );
  });

  it('keeps reset hints out of the views editor', async () => {
    const user = userEvent.setup();

    renderSidebar();

    await user.click(screen.getAllByRole('button', { name: /edit visible views/i })[0]!);
    expect(
      screen.queryByRole('menuitem', { name: /reset contextual hint history/i }),
    ).not.toBeInTheDocument();
  });

  it('does not show the old working directory card in multi-user mode', () => {
    authState.isMultiUserMode = true;

    renderSidebar();

    expect(screen.queryByTestId('sidebar-data-directory')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Change working directory')).not.toBeInTheDocument();
  });

  it('moves the working directory card out of the sidebar in single-user mode', () => {
    renderSidebar();

    expect(screen.queryByTestId('sidebar-data-directory')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Change working directory')).not.toBeInTheDocument();
  });

  it('removes the quotation engine shortcut from the quotation nav row', async () => {
    const user = userEvent.setup();

    renderSidebar();

    expect(screen.getByRole('button', { name: 'Quotation' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /configure quotation engine/i }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Quotation' }));
    expect(
      screen.queryByRole('button', { name: /configure quotation engine/i }),
    ).not.toBeInTheDocument();
  });
});
