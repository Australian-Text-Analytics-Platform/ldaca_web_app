import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Sidebar from '../Sidebar';
import { SidebarProvider } from '../../ui/sidebar';
import { DEFAULT_VISIBLE_VIEWS, useUIStore } from '../../../stores/uiStore';

vi.mock('@/hooks/useWorkspaceData', () => ({
  useWorkspaceData: () => ({
    workspaceGraph: { nodes: [] },
    currentWorkspaceId: 'ws-1',
  }),
}));

vi.mock('@/hooks/useWorkspaceSelection', () => ({
  useWorkspaceSelection: () => ({
    selectedNodeIds: [],
  }),
}));

vi.mock('@/hooks/useWorkspaceActions', () => ({
  useWorkspaceActions: () => ({
    toggleNodeSelection: vi.fn(),
  }),
}));

vi.mock('@/hooks/useWorkspaceTaskStream', () => ({
  useWorkspaceTaskStream: () => ({
    status: 'closed',
    error: null,
    reconnect: vi.fn(),
  }),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    getAuthHeaders: () => ({}),
    user: { name: 'Test User' },
    logout: vi.fn(),
    dataFolder: '/tmp/workdir',
    isMultiUserMode: false,
  }),
}));

vi.mock('@/stores/analysisStore', () => ({
  useAnalysisStore: (selector: (state: { tasks: []; setTasks: ReturnType<typeof vi.fn> }) => unknown) =>
    selector({ tasks: [], setTasks: vi.fn() }),
}));

vi.mock('@/stores/quotationEngineStore', () => ({
  useQuotationEngineDialogStore: (selector: (state: { open: ReturnType<typeof vi.fn> }) => unknown) =>
    selector({ open: vi.fn() }),
}));

vi.mock('@/components/dialogs/DataFolderDialog', () => ({
  DataFolderDialog: () => null,
}));

const renderSidebar = () =>
  render(
    <SidebarProvider>
      <Sidebar />
    </SidebarProvider>
  );

describe('Sidebar view visibility menu', () => {
  beforeEach(() => {
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
      isGlobalLoading: false,
      loadingOperations: new Set(),
      globalError: null,
      operationErrors: new Map(),
      modals: {
        joinModal: false,
        filterModal: false,
        documentColumnModal: false,
        renameModal: false,
        deleteConfirmModal: false,
        feedbackModal: false,
        tutorialModal: false,
      },
      tutorialTarget: null,
      visibleViews: [...DEFAULT_VISIBLE_VIEWS],
    }));
  });

  it('hides AI Annotator by default and allows showing it from the views editor', async () => {
    const user = userEvent.setup();

    renderSidebar();

    expect(screen.queryByRole('button', { name: 'AI Annotator' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Data Loader' })).toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: /edit visible views/i })[0]);

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

    await user.click(screen.getAllByRole('button', { name: /edit visible views/i })[0]);

    expect(screen.queryByRole('menuitemcheckbox', { name: 'Data Loader' })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitemcheckbox', { name: 'Data Structuring' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.getAllByRole('button', { name: 'Data Loader' }).length).toBeGreaterThan(0);
  });
});
