import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import WorkspaceNodeList from '../WorkspaceNodeList';
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

  it('paints a left accent from the node color while keeping the label legible', () => {
    render(
      <WorkspaceNodeList
        workspaceId="workspace-1"
        nodes={[{ id: 'node-1', name: 'Corpus', color: '#2563eb' }]}
        selectedNodeIds={[]}
        {...defaultRowActions}
        onToggleNodeSelection={vi.fn()}
      />,
    );

    const accentBox = screen.getByTestId('workspace-node-row-node-1');
    expect(accentBox).toHaveStyle({ borderLeftWidth: '4px' });
    expect(accentBox.style.borderLeftColor).not.toBe('');
    // The name is a sibling of the accent border, never overlaid by it.
    expect(screen.getByText('Corpus')).toBeInTheDocument();
  });

  it('defaults an uncoloured node to a grey spine and a background fill', () => {
    render(
      <WorkspaceNodeList
        workspaceId="workspace-1"
        nodes={[{ id: 'node-1', name: 'Corpus' }]}
        selectedNodeIds={[]}
        {...defaultRowActions}
        onToggleNodeSelection={vi.fn()}
      />,
    );

    // Un-analysed blocks default to grey: a 4px left spine plus a light fill,
    // rather than no accent at all.
    const accentBox = screen.getByTestId('workspace-node-row-node-1');
    expect(accentBox).toHaveStyle({ borderLeftWidth: '4px' });
    expect(accentBox.style.borderLeftColor).not.toBe('');
    expect(accentBox.style.backgroundColor).not.toBe('');
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
    expect(hoverToolbar).toHaveClass('left-1');
    expect(hoverToolbar).not.toHaveClass('right-1');
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
  });

  it('right-aligns long data-block names and fades the left edge for leading actions', () => {
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

    expect(label).toHaveClass('text-right');
    expect(label).not.toHaveClass('truncate');

    const fade = within(row).getByTestId('node-name-left-fade');
    expect(fade).toHaveClass('left-0');
    expect(fade).toHaveClass('group-hover/row:w-32');
  });
});
