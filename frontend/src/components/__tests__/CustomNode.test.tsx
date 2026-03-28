import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import CustomNode from '../CustomNode';

let mockZoom = 1;

vi.mock('@xyflow/react', () => ({
  Handle: () => <div data-testid="handle" />,
  Position: { Left: 'left', Right: 'right' },
  useStore: (selector: (state: { transform: [number, number, number] }) => number) => selector({ transform: [0, 0, mockZoom] }),
}));

const getLatestNodeSettingsButton = () => {
  const buttons = screen.getAllByRole('button', { name: /node settings/i });
  return buttons[buttons.length - 1] as HTMLButtonElement;
};

const getLatestDeleteButton = () => {
  const buttons = screen.getAllByRole('button', { name: /delete node/i });
  return buttons[buttons.length - 1] as HTMLButtonElement;
};

describe('CustomNode', () => {
  it('removes the save action from the node menu', async () => {
    mockZoom = 1;
    const user = userEvent.setup();
    const props = {
      id: 'node-1',
      type: 'custom',
      data: {
        node: {
          node_id: 'node-1',
          name: 'sample_data/ADO/qldelection2020_candidate_tweets',
          shape: [480, 8],
          columns: [],
          preview: [],
          is_text_data: false,
          can_undo: true,
          can_redo: false,
        },
        onDelete: vi.fn(),
        onRename: vi.fn(),
        onCopy: vi.fn(),
        onUndo: vi.fn(),
        onRedo: vi.fn(),
      },
      selected: false,
      dragging: false,
      zIndex: 0,
      selectable: true,
      deletable: true,
      draggable: true,
      isConnectable: true,
      positionAbsoluteX: 0,
      positionAbsoluteY: 0,
    } satisfies React.ComponentProps<typeof CustomNode>;

    render(<CustomNode {...props} />);

    await user.click(getLatestNodeSettingsButton());

    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rename' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clone' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Redo' })).toBeInTheDocument();
  });

  it('marks the rename input as non-draggable so React Flow does not intercept clicks', async () => {
    mockZoom = 1;
    const user = userEvent.setup();
    const props = {
      id: 'node-1',
      type: 'custom',
      data: {
        node: {
          node_id: 'node-1',
          name: 'sample_data/ADO/qldelection2020_samidata_tweets',
          shape: [2380, 15],
          columns: [],
          preview: [],
          is_text_data: false,
        },
        onDelete: vi.fn(),
        onRename: vi.fn(),
      },
      selected: false,
      dragging: false,
      zIndex: 0,
      selectable: true,
      deletable: true,
      draggable: true,
      isConnectable: true,
      positionAbsoluteX: 0,
      positionAbsoluteY: 0,
    } satisfies React.ComponentProps<typeof CustomNode>;

    render(
      <CustomNode {...props} />
    );

    await user.click(getLatestNodeSettingsButton());
    await user.click(screen.getByRole('button', { name: 'Rename' }));

    const renameInputs = screen.getAllByDisplayValue('sample_data/ADO/qldelection2020_samidata_tweets');
    const renameInput = renameInputs[renameInputs.length - 1] as HTMLInputElement;

    await waitFor(() => expect(renameInput).toHaveFocus());
    expect(renameInput).toHaveClass('nodrag');
    expect(renameInput).toHaveClass('nopan');
  });

  it('keeps settings and delete controls visible in the zoomed-out node view', async () => {
    mockZoom = 0.6;
    const user = userEvent.setup();
    const onDelete = vi.fn();
    const onRename = vi.fn();

    render(
      <CustomNode
        id="node-zoomed-out"
        type="custom"
        data={{
          node: {
            node_id: 'node-zoomed-out',
            name: 'sample_data/ADO/qldelection2020_candidate_tweets',
            shape: [480, 8],
            columns: [],
            preview: [],
            is_text_data: false,
            can_undo: true,
            can_redo: false,
          },
          onDelete,
          onRename,
          onCopy: vi.fn(),
          onUndo: vi.fn(),
          onRedo: vi.fn(),
        }}
        selected={false}
        dragging={false}
        zIndex={0}
        selectable
        deletable
        draggable
        isConnectable
        positionAbsoluteX={0}
        positionAbsoluteY={0}
    />
    );

    expect(getLatestNodeSettingsButton()).toBeInTheDocument();
    expect(getLatestDeleteButton()).toBeInTheDocument();

    await user.click(getLatestNodeSettingsButton());
    expect(screen.getByRole('button', { name: 'Rename' })).toBeInTheDocument();

    await user.click(getLatestDeleteButton());
    expect(onDelete).toHaveBeenCalledWith('node-zoomed-out');
  });
});