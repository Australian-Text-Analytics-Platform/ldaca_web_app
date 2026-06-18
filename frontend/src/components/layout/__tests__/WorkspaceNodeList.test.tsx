import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import WorkspaceNodeList from '../WorkspaceNodeList';

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

/** Three-node fixture used to exercise drag-to-reorder, which needs more than one row. */
const orderedNodes = [
  { id: 'node-1', data: { nodeName: 'Alpha' } },
  { id: 'node-2', data: { nodeName: 'Beta' } },
  { id: 'node-3', data: { nodeName: 'Gamma' } },
];

// WorkspaceNodeList uses pointer capture for ChromeTabs-style drag handling;
// jsdom does not implement it, so tests provide the minimal browser surface.
beforeAll(() => {
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => true);
});

afterAll(() => {
  vi.restoreAllMocks();
});

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

  it('commits a reordered id list when a row is dragged onto another row', () => {
    const onReorder = vi.fn();

    render(
      <WorkspaceNodeList
        nodes={orderedNodes}
        selectedNodeIds={[]}
        onToggleNodeSelection={vi.fn()}
        onReorder={onReorder}
      />,
    );

    const first = screen.getByRole('button', { name: 'Select Alpha' });

    fireEvent.pointerDown(first, { button: 0, pointerId: 1, clientY: 0 });
    fireEvent.pointerMove(first, { pointerId: 1, clientY: 48 });
    fireEvent.pointerUp(first, { pointerId: 1, clientY: 48 });

    // Alpha moves into Beta's slot, squeezing Beta up.
    expect(onReorder).toHaveBeenCalledWith(['node-2', 'node-1', 'node-3']);
  });

  it('does not make rows draggable without an onReorder handler', () => {
    render(
      <WorkspaceNodeList
        nodes={orderedNodes}
        selectedNodeIds={[]}
        onToggleNodeSelection={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Select Alpha' })).not.toHaveAttribute(
      'draggable',
      'true',
    );
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

