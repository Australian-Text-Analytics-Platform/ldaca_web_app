import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import Sidebar from '../Sidebar';
import { SidebarProvider } from '../../ui/sidebar';
import { DEFAULT_VISIBLE_VIEWS, useUIStore } from '@/stores/uiStore';
import { useHintsStore } from '@/stores/hintsStore';

/** Toast spy used to verify sidebar menu actions surface user feedback. */
const toastMock = vi.fn();

vi.mock('sonner', () => ({
  /** Used by: sidebar menu tests to assert toast feedback because the tests need reusable fixtures or mocks before exercising the behavior under assertion. */
  toast: (...args: unknown[]) => toastMock(...args),
}));

/**
 * Mutable auth fixture consumed by the mocked `useAuth` hook across sidebar visibility tests.
 * Why: tests need stable fixtures and mocks before exercising the behavior under assertion.
 */
const authState = {
  /**
   * Supplies empty request headers for sidebar consumers that ask auth before data calls.
   * Why: tests need stable fixtures and mocks before exercising the behavior under assertion.
   */
  getAuthHeaders: () => ({}),
  user: { name: 'Test User' },
  logout: vi.fn(),
  dataFolder: '/tmp/workdir',
  isMultiUserMode: false,
};

vi.mock('@/features/workspace/common/hooks/useWorkspaceData', () => ({
  /** Used by: Sidebar tests to provide an empty workspace graph fixture because the tests need reusable fixtures or mocks before exercising the behavior under assertion. */
  useWorkspaceData: () => ({
    workspaces: [],
    workspaceGraph: { nodes: [] },
    currentWorkspaceId: 'ws-1',
  }),
}));

vi.mock('@/features/workspace/common/hooks/useWorkspaceSelection', () => ({
  /** Used by: Sidebar tests to keep node-selection state empty because the tests need reusable fixtures or mocks before exercising the behavior under assertion. */
  useWorkspaceSelection: () => ({
    selectedNodeIds: [],
  }),
}));

vi.mock('@/features/workspace/common/hooks/useWorkspaceActions', () => ({
  /** Used by: Sidebar tests to stub child component workspace actions because the tests need reusable fixtures or mocks before exercising the behavior under assertion. */
  useWorkspaceActions: () => ({
    toggleNodeSelection: vi.fn(),
    setCurrentWorkspace: vi.fn(),
  }),
}));

vi.mock('@/features/workspace/task-stream/useWorkspaceTaskInbox', () => ({
  /** Used by: Sidebar tests to provide a quiet task-stream fixture because the tests need reusable fixtures or mocks before exercising the behavior under assertion. */
  useWorkspaceTaskInbox: () => ({
    status: 'closed',
    error: null,
    reconnect: vi.fn(),
  }),
}));

vi.mock('@/features/auth/hooks/useAuth', () => ({
  /**
   * Returns the mutable auth fixture used by sidebar account and action controls.
   * Why: tests need stable fixtures and mocks before exercising the behavior under assertion.
   */
  useAuth: () => authState,
}));

vi.mock('@/stores/analysisStore', () => ({
  /** Used by: Sidebar tests to expose an empty analysis-task store fixture because the tests need reusable fixtures or mocks before exercising the behavior under assertion. */
  useAnalysisStore: (
    selector: (state: { tasks: []; setTasks: ReturnType<typeof vi.fn> }) => unknown,
  ) => selector({ tasks: [], setTasks: vi.fn() }),
}));

/** Called by: Sidebar view-visibility tests before querying menu behavior because the tests need reusable fixtures or mocks before exercising the behavior under assertion. */
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
    authState.dataFolder = '/tmp/workdir';
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
      sidebarCollapsed: false,
      loadingOperations: new Set(),
      operationErrors: new Map(),
      modals: {
        feedback: false,
        tutorial: false,
        warning: false,
        info: false,
        reference: false,
      },
      modalTargets: {
        feedback: null,
        tutorial: null,
        warning: null,
        info: null,
        reference: null,
      },
      visibleViews: [...DEFAULT_VISIBLE_VIEWS],
      sessionDismissedHints: new Set(),
    }));
    useHintsStore.setState({ dismissedHints: [], hintsEnabled: true });
    toastMock.mockReset();
  });

  it('hides AI Annotator by default and allows showing it from the views editor', async () => {
    const user = userEvent.setup();

    renderSidebar();

    expect(screen.queryByRole('button', { name: 'AI Annotator' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Data Loader' })).toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: /edit visible views/i })[0]!);

    const aiAnnotatorToggle = screen.getByRole('menuitemcheckbox', { name: 'AI Annotator' });
    expect(aiAnnotatorToggle).not.toBeChecked();

    await user.click(aiAnnotatorToggle);
    expect(screen.getByRole('menuitemcheckbox', { name: 'AI Annotator' })).toBeChecked();

    await user.keyboard('{Escape}');

    expect(await screen.findByRole('button', { name: 'AI Annotator' })).toBeInTheDocument();
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

  it('opens Settings from the header cog and resets dismissed hints there', async () => {
    const user = userEvent.setup();

    useHintsStore.setState({
      dismissedHints: ['preprocessing.filter.select-node'],
      hintsEnabled: true,
    });
    useUIStore.setState((state) => ({
      ...state,
      sessionDismissedHints: new Set(['preprocessing.filter.select-column']),
    }));

    renderSidebar();

    await user.click(screen.getByRole('button', { name: /open settings/i }));
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /quotation/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /hints/i }));
    await user.click(screen.getByRole('button', { name: /reset all hints/i }));

    expect(useHintsStore.getState().dismissedHints).toEqual([]);
    expect(Array.from(useUIStore.getState().sessionDismissedHints)).toEqual([]);
    expect(toastMock).toHaveBeenCalledWith(
      'All hints have been reset. Dismissed hints can appear again.',
    );
  });

  it('keeps reset hints out of the views editor', async () => {
    const user = userEvent.setup();

    renderSidebar();

    await user.click(screen.getAllByRole('button', { name: /edit visible views/i })[0]!);
    expect(screen.queryByRole('menuitem', { name: 'Reset all hints' })).not.toBeInTheDocument();
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
