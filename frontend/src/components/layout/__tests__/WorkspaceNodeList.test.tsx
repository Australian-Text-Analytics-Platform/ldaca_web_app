import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import WorkspaceNodeList from '../WorkspaceNodeList';
import { usePinnedNodesStore } from '@/stores/pinnedNodesStore';

/** Minimal node fixture used to verify row activation and display-name behavior. */
const nodes = [
  {
    id: 'node-1',
    data: {
      nodeName: 'Corpus',
      shape: [12, 4] as [number, number],
    },
  },
];

/** Three-node fixture used to exercise client-side pin and selection grouping. */
const orderedNodes = [
  { id: 'node-1', data: { nodeName: 'Alpha' } },
  { id: 'node-2', data: { nodeName: 'Beta' } },
  { id: 'node-3', data: { nodeName: 'Gamma' } },
];

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

  it('groups pinned nodes before selected non-pinned nodes and regular nodes', () => {
    usePinnedNodesStore.getState().togglePinnedNode('node-3');
    render(
      <WorkspaceNodeList
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
        nodes={orderedNodes}
        selectedNodeIds={[]}
        onToggleNodeSelection={vi.fn()}
        renderRowActions={(node) => (
          <button
            type="button"
            data-pin-action
            data-pinned={usePinnedNodesStore.getState().isPinned(node.id)}
            onClick={() => { usePinnedNodesStore.getState().togglePinnedNode(node.id); }}
            aria-label={`${usePinnedNodesStore.getState().isPinned(node.id) ? 'Unpin' : 'Pin'} ${node.data?.nodeName ?? node.id}`}
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
        nodes={orderedNodes}
        selectedNodeIds={[]}
        onToggleNodeSelection={vi.fn()}
        renderPinnedRowAction={(node) => (
          <button type="button" data-pin-action aria-label={`Unpin ${node.data?.nodeName ?? node.id}`}>Pin</button>
        )}
        renderRowActions={(node) => (
          <>
            <button type="button" data-pin-action aria-label={`Unpin ${node.data?.nodeName ?? node.id}`}>Pin</button>
            <button type="button" aria-label={`More actions for ${node.data?.nodeName ?? node.id}`}>More</button>
          </>
        )}
      />,
    );

    const betaRow = screen.getByRole('button', { name: 'Select Beta' });
    const pinVisibility = within(betaRow).getByTestId('pinned-row-pin-action');
    const hoverToolbar = within(betaRow).getByRole('toolbar', { name: 'Actions for Beta' });

    expect(within(pinVisibility).getByRole('button', { name: 'Unpin Beta' })).toBeInTheDocument();
    expect(hoverToolbar).toHaveClass('opacity-0');
  });

  it('shows a graph-style selection header and batch-deletes selected rows', async () => {
    const user = userEvent.setup();
    const onDeleteSelected = vi.fn().mockResolvedValue(undefined);
    const onClearSelection = vi.fn();

    render(
      <WorkspaceNodeList
        nodes={orderedNodes}
        selectedNodeIds={['node-2']}
        onToggleNodeSelection={vi.fn()}
        onClearSelection={onClearSelection}
        onDeleteSelected={onDeleteSelected}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Delete selected data blocks' }));
    expect(screen.getByRole('heading', { name: 'Delete 1 data block?' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete 1' }));

    await waitFor(() => {
      expect(onDeleteSelected).toHaveBeenCalledWith(['node-2']);
    });
    expect(onClearSelection).toHaveBeenCalledOnce();
  });
});

