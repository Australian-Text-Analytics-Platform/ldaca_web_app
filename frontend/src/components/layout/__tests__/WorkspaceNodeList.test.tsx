import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import WorkspaceNodeList from '../WorkspaceNodeList';
import {
  GREY,
  VIZ_LIGHT_FOREGROUND,
  foregroundForVizColor,
} from '@/features/views/common/vizPalette';
import { usePinnedNodesStore } from '@/stores/pinnedNodesStore';

/** Minimal node fixture used to verify row activation and display-name behavior. */
const nodes = [
  {
    id: 'node-1',
    name: 'Corpus',
  },
];

/** Three-node fixture used to exercise client-side pin and selection grouping. */
const orderedNodes = [
  { id: 'node-1', name: 'Alpha' },
  { id: 'node-2', name: 'Beta' },
  { id: 'node-3', name: 'Gamma' },
];

const defaultRowActions = {
  renderPinnedRowAction: () => null,
  renderRowActions: () => null,
};

const longNodeName = 'full_filtered_by_username_in_AnnastaciaMP_topic_topic_meanings';

afterEach(() => {
  usePinnedNodesStore.getState().reset();
});

/** Reads row labels in the DOM order seen by users. */
const getRenderedRowNames = () =>
  screen
    .getAllByRole('button', { name: /^(Select|Deselect) /u })
    .map((row) => row.getAttribute('aria-label')?.replace(/^(Select|Deselect) /u, ''));

describe('WorkspaceNodeList', () => {
  it('uses a non-button row wrapper and supports click and keyboard toggling', async () => {
    const user = userEvent.setup();
    const onToggleNodeSelection = vi.fn();

    render(
      <WorkspaceNodeList
        {...defaultRowActions}
        workspaceId="workspace-1"
        nodes={nodes}
        selectedNodeIds={[]}
        onToggleNodeSelection={onToggleNodeSelection}
      />,
    );

    const row = screen.getByRole('button', { name: 'Select Corpus' });

    expect(row.tagName).toBe('DIV');

    await user.click(row);
    expect(onToggleNodeSelection).toHaveBeenCalledWith('node-1');

    row.focus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');

    expect(onToggleNodeSelection).toHaveBeenCalledTimes(3);
  });

  it('uses the saturated node color as the identity surface with legible text', () => {
    render(
      <WorkspaceNodeList
        workspaceId="workspace-1"
        nodes={[{ id: 'node-1', name: 'Corpus', color: '#2563eb' }]}
        selectedNodeIds={[]}
        {...defaultRowActions}
        onToggleNodeSelection={vi.fn()}
      />,
    );

    const identitySurface = screen.getByTestId('workspace-node-row-node-1');
    expect(identitySurface).toHaveStyle({
      backgroundColor: '#2563eb',
      color: VIZ_LIGHT_FOREGROUND,
    });
    expect(identitySurface.style.borderLeftWidth).toBe('');
    expect(screen.getByTestId('data-block-name-head-fade').style.backgroundImage).toContain(
      identitySurface.style.backgroundColor,
    );
  });

  it('defaults an uncoloured node to a saturated grey identity surface', () => {
    render(
      <WorkspaceNodeList
        workspaceId="workspace-1"
        nodes={[{ id: 'node-1', name: 'Corpus' }]}
        selectedNodeIds={[]}
        {...defaultRowActions}
        onToggleNodeSelection={vi.fn()}
      />,
    );

    const identitySurface = screen.getByTestId('workspace-node-row-node-1');
    expect(identitySurface).toHaveStyle({
      backgroundColor: GREY,
      color: foregroundForVizColor(GREY),
    });
    expect(identitySurface.style.borderLeftWidth).toBe('');
  });

  it('uses one detached inverse-neutral outline for selection', () => {
    render(
      <WorkspaceNodeList
        workspaceId="workspace-1"
        nodes={nodes}
        selectedNodeIds={['node-1']}
        {...defaultRowActions}
        onToggleNodeSelection={vi.fn()}
      />,
    );

    const selectedSurface = screen.getByTestId('workspace-node-row-node-1');
    expect(selectedSurface).toHaveClass(
      'outline-2',
      'outline-offset-2',
      'outline-data-block-selection',
    );
    expect(selectedSurface).not.toHaveClass('ring-focus/20');
  });

  it('groups pinned nodes before selected non-pinned nodes and regular nodes', () => {
    usePinnedNodesStore.getState().togglePinnedNode('node-3');
    render(
      <WorkspaceNodeList
        {...defaultRowActions}
        workspaceId="workspace-1"
        nodes={orderedNodes}
        selectedNodeIds={['node-2', 'node-3']}
        onToggleNodeSelection={vi.fn()}
      />,
    );

    expect(getRenderedRowNames()).toEqual(['Gamma', 'Beta', 'Alpha']);
  });

  it('pins nodes through the row toolbar and appends them to the pinned group', async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceNodeList
        renderPinnedRowAction={() => null}
        workspaceId="workspace-1"
        nodes={orderedNodes}
        selectedNodeIds={[]}
        onToggleNodeSelection={vi.fn()}
        renderRowActions={(node) => (
          <button
            type="button"
            data-pin-action
            data-pinned={usePinnedNodesStore.getState().isPinned(node.id)}
            onClick={() => {
              usePinnedNodesStore.getState().togglePinnedNode(node.id);
            }}
            aria-label={`${usePinnedNodesStore.getState().isPinned(node.id) ? 'Unpin' : 'Pin'} ${node.name}`}
          >
            Pin
          </button>
        )}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Pin Beta' }));

    expect(usePinnedNodesStore.getState().pinnedNodeIds).toEqual(['node-2']);
    expect(getRenderedRowNames()).toEqual(['Beta', 'Alpha', 'Gamma']);
  });

  it('keeps only the pinned pin action visible at rest', () => {
    usePinnedNodesStore.getState().togglePinnedNode('node-2');
    render(
      <WorkspaceNodeList
        workspaceId="workspace-1"
        nodes={orderedNodes}
        selectedNodeIds={[]}
        onToggleNodeSelection={vi.fn()}
        renderPinnedRowAction={(node) => (
          <button type="button" data-pin-action aria-label={`Unpin ${node.name}`}>
            Pin
          </button>
        )}
        renderRowActions={(node) => (
          <>
            <button type="button" data-pin-action aria-label={`Unpin ${node.name}`}>
              Pin
            </button>
            <button type="button" aria-label={`More actions for ${node.name}`}>
              More
            </button>
          </>
        )}
      />,
    );

    const betaRow = screen.getByRole('button', { name: 'Select Beta' });
    const pinVisibility = within(betaRow).getByTestId('pinned-row-pin-action');
    const hoverToolbar = within(betaRow).getByRole('toolbar', { name: 'Actions for Beta' });

    expect(within(pinVisibility).getByRole('button', { name: 'Unpin Beta' })).toBeInTheDocument();
    expect(hoverToolbar).toHaveClass('opacity-0');
    expect(hoverToolbar).toHaveClass('invisible');
    expect(hoverToolbar).toHaveClass('left-1');
    expect(hoverToolbar).not.toHaveClass('right-1');
    expect(hoverToolbar).not.toHaveClass('rounded-md', 'bg-surface', 'p-0.5');
    expect(pinVisibility).toHaveClass('group-focus-within/row:invisible');
  });

  it('lets hover-revealed row actions receive pointer clicks', () => {
    render(
      <WorkspaceNodeList
        renderPinnedRowAction={() => null}
        workspaceId="workspace-1"
        nodes={orderedNodes}
        selectedNodeIds={[]}
        onToggleNodeSelection={vi.fn()}
        renderRowActions={(node) => (
          <button type="button" aria-label={`Add ${node.name}`}>
            Add
          </button>
        )}
      />,
    );

    const betaRow = screen.getByRole('button', { name: 'Select Beta' });
    const hoverToolbar = within(betaRow).getByRole('toolbar', { name: 'Actions for Beta' });

    expect(hoverToolbar).toHaveClass('pointer-events-none');
    expect(hoverToolbar).toHaveClass('group-hover/row:!pointer-events-auto');
    expect(hoverToolbar).toHaveClass(
      'group-focus-within/row:visible',
      'group-focus-within/row:!pointer-events-auto',
      'group-focus-within/row:opacity-100',
    );
  });

  it('keeps long-name suffixes on one line and fades the clipped head', () => {
    render(
      <WorkspaceNodeList
        workspaceId="workspace-1"
        nodes={[{ id: 'node-long', name: longNodeName }]}
        renderPinnedRowAction={() => null}
        selectedNodeIds={[]}
        onToggleNodeSelection={vi.fn()}
        renderRowActions={() => (
          <button type="button" aria-label="Inspect data block">
            Inspect
          </button>
        )}
      />,
    );

    const row = screen.getByRole('button', { name: `Select ${longNodeName}` });
    const label = within(row).getByText(longNodeName);
    const nameViewport = within(row).getByTestId('data-block-name');

    expect(label).toHaveClass('whitespace-nowrap');
    expect(label).not.toHaveClass('truncate');
    expect(nameViewport).toHaveStyle({ maxHeight: '1lh' });

    const fade = within(row).getByTestId('data-block-name-head-fade');
    expect(fade).toHaveClass('left-0');
    expect(fade).not.toHaveClass('right-0');
    expect(fade).toHaveClass('group-hover/row:w-28');
  });
});
