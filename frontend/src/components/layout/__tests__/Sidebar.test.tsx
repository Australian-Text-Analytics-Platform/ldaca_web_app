import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Sidebar from '../Sidebar';
import { SidebarProvider } from '@/components/ui/sidebar';

const mockUseWorkspaceData = vi.fn();
const mockUseWorkspaceSelection = vi.fn();
const mockUseWorkspaceActions = vi.fn();
const mockUseWorkspaceTaskStream = vi.fn();
const mockUseAuth = vi.fn();
const mockUseAnalysisStore = vi.fn();
const mockUseUIStore = vi.fn();
const mockUseQuotationEngineDialogStore = vi.fn();

vi.mock('@/hooks/useWorkspaceData', () => ({
  useWorkspaceData: () => mockUseWorkspaceData(),
}));

vi.mock('@/hooks/useWorkspaceSelection', () => ({
  useWorkspaceSelection: () => mockUseWorkspaceSelection(),
}));

vi.mock('@/hooks/useWorkspaceActions', () => ({
  useWorkspaceActions: () => mockUseWorkspaceActions(),
}));

vi.mock('@/hooks/useWorkspaceTaskStream', () => ({
  useWorkspaceTaskStream: () => mockUseWorkspaceTaskStream(),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('@/api/workspaces', () => {
  const cancelTasks = vi.fn();
  const clearTasks = vi.fn();
  return {
    workspacesApi: {
      cancelTasks,
      clearTasks,
    },
  };
});

vi.mock('@/stores/analysisStore', () => ({
  useAnalysisStore: (selector?: (state: any) => any) =>
    selector ? selector(mockUseAnalysisStore()) : mockUseAnalysisStore(),
}));

vi.mock('@/stores', () => ({
  useUIStore: (selector?: (state: any) => any) =>
    selector ? selector(mockUseUIStore()) : mockUseUIStore(),
}));

vi.mock('@/stores/quotationEngineStore', () => ({
  useQuotationEngineDialogStore: (selector?: (state: any) => any) =>
    selector ? selector(mockUseQuotationEngineDialogStore()) : mockUseQuotationEngineDialogStore(),
}));

vi.mock('@/components/layout/sidebar/SidebarNodesSection', () => ({
  __esModule: true,
  default: ({ nodes }: { nodes: Array<unknown> }) => (
    <div data-testid="nodes-section">Nodes section ({nodes.length})</div>
  ),
}));

vi.mock('@/components/layout/sidebar/SidebarTasksSection', () => ({
  __esModule: true,
  default: ({ tasks }: { tasks: Array<unknown> }) => (
    <div data-testid="tasks-section">Tasks section ({tasks.length})</div>
  ),
}));

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => false,
}));

vi.mock('@/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/logo.png', () => ({
  __esModule: true,
  default: 'logo.png',
}));

const renderSidebar = () =>
  render(
    <SidebarProvider>
      <Sidebar />
    </SidebarProvider>
  );

let workspaceDataState: any;
let workspaceSelectionState: any;
let workspaceActionsState: any;
let workspaceTaskStreamState: any;
let authState: any;
let analysisStoreState: any;
let uiStoreState: any;
let quotationStoreState: any;

beforeEach(() => {
  workspaceDataState = {
    workspaceGraph: { nodes: [{ id: 'n1' }, { id: 'n2' }] },
    currentWorkspaceId: 'workspace-123',
  };
  workspaceSelectionState = { selectedNodeIds: ['n1'] };
  workspaceActionsState = { toggleNodeSelection: vi.fn() };
  workspaceTaskStreamState = { status: 'open', error: null, reconnect: vi.fn() };
  authState = {
    getAuthHeaders: vi.fn(),
    user: { name: 'Test User' },
    logout: vi.fn(),
    dataFolder: '/tmp/data',
    isMultiUserMode: true,
  };
  analysisStoreState = { tasks: [], setTasks: vi.fn() };
  uiStoreState = {
    currentView: 'data-loader',
    setCurrentView: vi.fn(),
    openFeedbackModal: vi.fn(),
  };
  quotationStoreState = { open: vi.fn() };

  mockUseWorkspaceData.mockImplementation(() => workspaceDataState);
  mockUseWorkspaceSelection.mockImplementation(() => workspaceSelectionState);
  mockUseWorkspaceActions.mockImplementation(() => workspaceActionsState);
  mockUseWorkspaceTaskStream.mockImplementation(() => workspaceTaskStreamState);
  mockUseAuth.mockImplementation(() => authState);
  mockUseAnalysisStore.mockImplementation(() => analysisStoreState);
  mockUseUIStore.mockImplementation(() => uiStoreState);
  mockUseQuotationEngineDialogStore.mockImplementation(() => quotationStoreState);

});

describe('Sidebar layout shell', () => {
  it('collapses the Views section and hides nav links when toggled', async () => {
    const user = userEvent.setup();
    renderSidebar();

    const viewsHeader = screen.getByRole('button', { name: /views/i });
    expect(viewsHeader).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Data Loader')).toBeVisible();

    await user.click(viewsHeader);

    expect(viewsHeader).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Data Loader')).not.toBeInTheDocument();
  });

  it('shows the node count and updates the task stream indicator', () => {
    const { rerender } = renderSidebar();

    const nodesHeader = screen.getAllByRole('button', { name: /nodes/i })[0];
    expect(within(nodesHeader).getByText('2')).toBeInTheDocument();

    const getIndicator = () => {
      const icons = screen.getAllByTestId('tasks-connection-indicator');
      return icons[icons.length - 1];
    };

    let statusIcon = getIndicator();
    expect(statusIcon).toHaveClass('text-green-500');

    workspaceTaskStreamState = { status: 'error', error: 'boom', reconnect: vi.fn() };
    rerender(
      <SidebarProvider>
        <Sidebar />
      </SidebarProvider>
    );

    statusIcon = getIndicator();
    expect(statusIcon).toHaveClass('text-red-500');
    expect(screen.getAllByTestId('tasks-section').length).toBeGreaterThan(0);
  });
});
