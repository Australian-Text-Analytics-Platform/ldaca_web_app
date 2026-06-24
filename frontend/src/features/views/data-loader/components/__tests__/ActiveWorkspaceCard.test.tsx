import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ActiveWorkspaceCard } from '../ActiveWorkspaceCard';
import type { WorkspaceListItem } from '../WorkspaceManagerCard';

vi.mock('@/components/help/HelpIcon', () => ({
  /** Keeps help chrome out of focused ActiveWorkspaceCard behavior tests. */
  default: () => null,
}));

const workspace: WorkspaceListItem = {
  id: 'ws-1',
  name: 'Main Workspace',
  description: 'Initial description',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-02T00:00:00Z',
  workspace_size_Byte: 1024,
};

/**
 * Renders the card with inert workspace actions so each test can override only
 * the behavior it needs to assert.
 * Used by: ActiveWorkspaceCard tests because the component is a form boundary
 * whose callbacks are supplied by DataLoaderFeature in production.
 */
function renderCard(overrides: Partial<ComponentProps<typeof ActiveWorkspaceCard>> = {}) {
  const props: ComponentProps<typeof ActiveWorkspaceCard> = {
    currentWorkspace: workspace,
    nodeCount: 2,
    busy: false,
    onCreate: vi.fn().mockResolvedValue(true),
    onRename: vi.fn(),
    onUpdateDescription: vi.fn(),
    onSave: vi.fn(),
    onUnload: vi.fn(),
    ...overrides,
  };
  return {
    ...render(<ActiveWorkspaceCard {...props} />),
    props,
  };
}

describe('ActiveWorkspaceCard', () => {
  it('clears create drafts only after the workspace create action succeeds', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue(true);
    renderCard({ currentWorkspace: null, onCreate });

    await user.type(screen.getByPlaceholderText('Workspace name'), 'New workspace');
    await user.type(screen.getByPlaceholderText('Optional description'), 'Project notes');
    await user.click(screen.getByRole('button', { name: /create workspace/i }));

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith('New workspace', 'Project notes');
    });
    expect(screen.getByPlaceholderText('Workspace name')).toHaveValue('');
    expect(screen.getByPlaceholderText('Optional description')).toHaveValue('');
  });

  it('keeps create drafts when the workspace create action fails', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue(false);
    renderCard({ currentWorkspace: null, onCreate });

    await user.type(screen.getByPlaceholderText('Workspace name'), 'New workspace');
    await user.type(screen.getByPlaceholderText('Optional description'), 'Project notes');
    await user.click(screen.getByRole('button', { name: /create workspace/i }));

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith('New workspace', 'Project notes');
    });
    expect(screen.getByPlaceholderText('Workspace name')).toHaveValue('New workspace');
    expect(screen.getByPlaceholderText('Optional description')).toHaveValue('Project notes');
  });

  it('resets active workspace drafts when persisted workspace details change', async () => {
    const user = userEvent.setup();
    const { rerender, props } = renderCard();

    await user.clear(screen.getByPlaceholderText('Enter new name'));
    await user.type(screen.getByPlaceholderText('Enter new name'), 'Unsaved name');
    await user.clear(screen.getByLabelText('Workspace description'));
    await user.type(screen.getByLabelText('Workspace description'), 'Unsaved description');

    rerender(
      <ActiveWorkspaceCard
        {...props}
        currentWorkspace={{
          ...workspace,
          name: 'Persisted rename',
          description: 'Persisted description',
        }}
      />,
    );

    expect(screen.getByDisplayValue('Persisted rename')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Persisted description')).toBeInTheDocument();
  });

  it('blocks unloading while an active workspace task is running', () => {
    const onUnload = vi.fn();
    renderCard({ hasActiveTask: true, onUnload });

    expect(screen.getByRole('button', { name: /unload/i })).toBeDisabled();
  });
});
