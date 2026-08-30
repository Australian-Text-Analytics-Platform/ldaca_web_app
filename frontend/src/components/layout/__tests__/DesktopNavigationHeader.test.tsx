import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Tab } from '@/api';
import { TooltipProvider } from '@/components/ui/tooltip';
import { DesktopNavigationHeaderView } from '../DesktopNavigationHeader';

const tabs: Tab[] = [
  {
    availability: 'available',
    id: 'frequency-1',
    kind: 'token_frequency',
    name: 'Analysis 1',
    created_at: '2026-08-28T00:00:00Z',
    modified_at: '2026-08-28T00:00:00Z',
    revision: 1,
    settings: { kind: 'token_frequency', stop_words: { words: [] } },
  },
  {
    availability: 'available',
    id: 'trends-1',
    kind: 'sequential',
    name: 'Timeline comparison',
    created_at: '2026-08-28T00:00:00Z',
    modified_at: '2026-08-28T00:00:00Z',
    revision: 1,
    settings: { kind: 'sequential' },
  },
];

const baseProps: React.ComponentProps<typeof DesktopNavigationHeaderView> = {
  workspaceName: 'Election analysis',
  tabs,
  currentTabId: 'frequency-1',
  isLoading: false,
  isError: false,
  canGoBack: true,
  canGoForward: false,
  hasNativeTrafficLights: false,
  onBack: vi.fn(),
  onForward: vi.fn(),
  onSelectTab: vi.fn(),
  onRetry: vi.fn(),
};

const renderHeader = (props: React.ComponentProps<typeof DesktopNavigationHeaderView>) =>
  render(
    <TooltipProvider>
      <DesktopNavigationHeaderView {...props} />
    </TooltipProvider>,
  );

describe('DesktopNavigationHeaderView', () => {
  it('renders VS Code-style controls while keeping only background chrome draggable', () => {
    renderHeader(baseProps);

    const header = screen.getByTestId('desktop-navigation-header');
    const navigation = screen.getByRole('navigation', { name: 'Navigation history' });
    const quickAccess = screen.getByRole('button', { name: 'Open quick access' });
    const settings = screen.getByRole('button', { name: 'Open settings' });
    const about = screen.getByRole('button', { name: 'About Wordflow' });
    const citation = screen.getByRole('button', { name: 'Cite LDaCA Wordflow' });

    expect(header).toHaveAttribute('data-tauri-drag-region', 'deep');
    expect(header).not.toHaveClass('border-b');
    expect(header).toHaveClass('pl-2');
    expect(within(header).getByText('Wordflow')).toHaveClass('text-[15px]');
    expect(within(header).getByText('by')).toBeVisible();
    expect(within(header).getByRole('img', { name: 'LDaCA Logo' })).toHaveClass(
      'ml-1.5',
      'h-[28px]',
    );
    expect(header).toContainElement(navigation);
    expect(navigation.compareDocumentPosition(settings)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(navigation).toHaveAttribute('data-tauri-drag-region', 'false');
    expect(navigation.compareDocumentPosition(quickAccess)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(about).toBeVisible();
    expect(citation).toBeVisible();
    expect(screen.getByTestId('desktop-header-about-control')).toHaveAttribute(
      'data-tauri-drag-region',
      'false',
    );
    expect(screen.getByTestId('desktop-header-citation-control')).toHaveAttribute(
      'data-tauri-drag-region',
      'false',
    );
    expect(settings).toHaveAttribute('data-tauri-drag-region', 'false');
    expect(screen.getByRole('button', { name: 'Go back' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Go forward' })).toBeDisabled();
    expect(screen.getByTestId('desktop-header-back-icon')).toHaveClass('!size-[18px]');
    expect(screen.getByTestId('desktop-header-forward-icon')).toHaveClass('!size-[18px]');
    expect(screen.getByTestId('desktop-header-search-icon')).toHaveClass('size-[18px]');
    expect(screen.getByTestId('settings-button-icon')).toHaveClass('!size-[18px]');
    expect(quickAccess).toHaveTextContent('Election analysis');
    expect(quickAccess).toHaveClass('h-[22px]', 'w-[38vw]', 'max-w-[600px]');
    expect(quickAccess).toHaveClass('text-[13px]');
    expect(quickAccess).toHaveClass(
      'bg-[var(--vscode-commandCenter-background)]',
      'text-[var(--vscode-commandCenter-foreground)]',
    );
    expect(quickAccess).toHaveAttribute('data-tauri-drag-region', 'false');
  });

  it('reserves native traffic-light clearance only in the macOS desktop shell', () => {
    renderHeader({ ...baseProps, hasNativeTrafficLights: true });

    expect(screen.getByTestId('desktop-navigation-header')).toHaveClass('pl-[78px]');
  });

  it('opens with focused search, filters Tabs, and marks the active Tab', async () => {
    const user = userEvent.setup();
    renderHeader(baseProps);

    await user.click(screen.getByRole('button', { name: 'Open quick access' }));
    const search = screen.getByRole('textbox', { name: 'Search analysis tabs' });
    expect(search).toHaveFocus();
    expect(screen.getByRole('option', { name: 'Token Frequency: Analysis 1' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await user.type(search, 'timeline');
    expect(screen.queryByRole('option', { name: 'Token Frequency: Analysis 1' })).toBeNull();
    expect(screen.getByRole('option', { name: 'Trends: Timeline comparison' })).toBeVisible();
  });

  it('supports keyboard selection and closes after choosing a Tab', async () => {
    const user = userEvent.setup();
    const onSelectTab = vi.fn();
    renderHeader({ ...baseProps, onSelectTab });

    await user.click(screen.getByRole('button', { name: 'Open quick access' }));
    const search = screen.getByRole('textbox', { name: 'Search analysis tabs' });
    await user.keyboard('{ArrowDown}{Enter}');

    expect(onSelectTab).toHaveBeenCalledWith(tabs[1]);
    expect(search).not.toBeInTheDocument();
  });

  it.each([
    {
      name: 'loading',
      props: { isLoading: true },
      message: 'Loading Tabs…',
    },
    {
      name: 'no Workspace',
      props: { workspaceName: 'No workspace', tabs: [] },
      message: 'Load a Workspace to access analysis Tabs.',
    },
    {
      name: 'no Tabs',
      props: { tabs: [] },
      message: 'This Workspace has no analysis Tabs.',
    },
  ])('shows the $name state', async ({ props, message }) => {
    const user = userEvent.setup();
    renderHeader({ ...baseProps, ...props });
    await user.click(screen.getByRole('button', { name: 'Open quick access' }));
    expect(screen.getByText(message)).toBeVisible();
  });

  it('shows a recoverable Query error', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    renderHeader({ ...baseProps, isError: true, isLoading: false, onRetry });
    await user.click(screen.getByRole('button', { name: 'Open quick access' }));
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('renders persisted warnings for unavailable Tabs', async () => {
    const user = userEvent.setup();
    renderHeader({
      ...baseProps,
      unavailableTabWarnings: ['This Tab is unavailable because its stored record is invalid.'],
    });
    await user.click(screen.getByRole('button', { name: 'Open quick access' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'This Tab is unavailable because its stored record is invalid.',
    );
  });
});
