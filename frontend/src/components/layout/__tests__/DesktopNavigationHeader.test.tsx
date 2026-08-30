import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Tab } from '@/api';
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
  onBack: vi.fn(),
  onForward: vi.fn(),
  onSelectTab: vi.fn(),
  onRetry: vi.fn(),
};

describe('DesktopNavigationHeaderView', () => {
  it('renders VS Code-style controls while keeping only background chrome draggable', () => {
    render(<DesktopNavigationHeaderView {...baseProps} />);

    const header = screen.getByTestId('desktop-navigation-header');
    const navigation = screen.getByRole('navigation', { name: 'Navigation history' });
    const quickAccess = screen.getByRole('button', { name: 'Open quick access' });

    expect(header).toHaveAttribute('data-tauri-drag-region', 'deep');
    expect(header).not.toHaveClass('border-b');
    expect(navigation).toHaveAttribute('data-tauri-drag-region', 'false');
    expect(navigation.compareDocumentPosition(quickAccess)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getByRole('button', { name: 'Go back' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Go forward' })).toBeDisabled();
    expect(quickAccess).toHaveTextContent('Election analysis');
    expect(quickAccess).toHaveClass('h-[22px]', 'w-[38vw]', 'max-w-[600px]');
    expect(quickAccess).toHaveClass(
      'bg-[var(--vscode-commandCenter-background)]',
      'text-[var(--vscode-commandCenter-foreground)]',
    );
    expect(quickAccess).toHaveAttribute('data-tauri-drag-region', 'false');
  });

  it('opens with focused search, filters Tabs, and marks the active Tab', async () => {
    const user = userEvent.setup();
    render(<DesktopNavigationHeaderView {...baseProps} />);

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
    render(<DesktopNavigationHeaderView {...baseProps} onSelectTab={onSelectTab} />);

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
    render(<DesktopNavigationHeaderView {...baseProps} {...props} />);
    await user.click(screen.getByRole('button', { name: 'Open quick access' }));
    expect(screen.getByText(message)).toBeVisible();
  });

  it('shows a recoverable Query error', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <DesktopNavigationHeaderView {...baseProps} isError isLoading={false} onRetry={onRetry} />,
    );
    await user.click(screen.getByRole('button', { name: 'Open quick access' }));
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('renders persisted warnings for unavailable Tabs', async () => {
    const user = userEvent.setup();
    render(
      <DesktopNavigationHeaderView
        {...baseProps}
        unavailableTabWarnings={['This Tab is unavailable because its stored record is invalid.']}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Open quick access' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'This Tab is unavailable because its stored record is invalid.',
    );
  });
});
