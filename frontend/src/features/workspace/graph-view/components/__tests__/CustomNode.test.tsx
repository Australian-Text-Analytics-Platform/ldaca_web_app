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
    mockZoom = 0.59;
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

    await user.click(getLatestNodeSettingsButton());
    expect(screen.getByRole('button', { name: 'Rename' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByText(/This action cannot be undone/)).toBeInTheDocument();
  });

  it('does not render a derived-columns row when none are present', () => {
    mockZoom = 1;
    const props = {
      id: 'node-1',
      type: 'custom',
      data: {
        node: {
          node_id: 'node-1',
          name: 'plain',
          shape: [3, 2] as [number, number],
          columns: ['text', 'value'],
          preview: [],
          is_text_data: true,
        },
        onDelete: vi.fn(),
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
    expect(screen.queryByText(/tokens columns/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^tokens:/)).not.toBeInTheDocument();
  });

  it('shows a single-line tokenisation summary from metadata', () => {
    mockZoom = 1;
    const props = {
      id: 'node-1',
      type: 'custom',
      data: {
        node: {
          node_id: 'node-1',
          name: 'zh-corpus',
          shape: [3, 2] as [number, number],
          columns: ['text'],
          preview: [],
          is_text_data: true,
          derived: {
            'text.tokenization.jieba': {
              source_column: 'text',
              form: 'tokens',
              model: 'jieba',
              language: 'zh',
              generated_at: '2026-05-12T00:00:00+00:00',
            },
          },
        },
        onDelete: vi.fn(),
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
    expect(screen.getByText('tokens: text · jieba')).toBeInTheDocument();
  });

  it('exposes a Tokenise entry in the node menu when the node has columns', async () => {
    mockZoom = 1;
    const user = userEvent.setup();
    const props = {
      id: 'node-1',
      type: 'custom',
      data: {
        node: {
          node_id: 'node-1',
          name: 'tokenisable',
          shape: [3, 2] as [number, number],
          columns: ['text', 'title'],
          preview: [],
          is_text_data: true,
        },
        onDelete: vi.fn(),
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
    expect(
      screen.getByRole('button', { name: 'Tokenise…' }),
    ).toBeInTheDocument();
  });

  it('omits the Tokenise entry when the node has no columns', async () => {
    mockZoom = 1;
    const user = userEvent.setup();
    const props = {
      id: 'node-1',
      type: 'custom',
      data: {
        node: {
          node_id: 'node-1',
          name: 'empty',
          shape: [0, 0] as [number, number],
          columns: [],
          preview: [],
          is_text_data: false,
        },
        onDelete: vi.fn(),
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
    expect(
      screen.queryByRole('button', { name: 'Tokenise…' }),
    ).not.toBeInTheDocument();
  });

  it('never exposes a Manage tokens menu entry', async () => {
    mockZoom = 1;
    const user = userEvent.setup();
    const baseNode = {
      node_id: 'node-1',
      name: 'tokenisable',
      shape: [3, 2] as [number, number],
      columns: ['text'],
      preview: [],
      is_text_data: true,
    };

    const { unmount } = render(
      <CustomNode
        id="node-1"
        type="custom"
        data={{ node: baseNode, onDelete: vi.fn() }}
        selected={false}
        dragging={false}
        zIndex={0}
        selectable
        deletable
        draggable
        isConnectable
        positionAbsoluteX={0}
        positionAbsoluteY={0}
      />,
    );
    await user.click(getLatestNodeSettingsButton());
    expect(
      screen.queryByRole('button', { name: 'Manage tokens…' }),
    ).not.toBeInTheDocument();
    unmount();

    render(
      <CustomNode
        id="node-1"
        type="custom"
        data={{
          node: {
            ...baseNode,
            derived: {
              'text.tokenization.jieba': {
                source_column: 'text',
                form: 'tokens',
                model: 'jieba',
                language: 'zh',
                generated_at: '2026-05-12T00:00:00+00:00',
              },
            },
          },
          onDelete: vi.fn(),
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
      />,
    );
    await user.click(getLatestNodeSettingsButton());
    expect(
      screen.queryByRole('button', { name: 'Manage tokens…' }),
    ).not.toBeInTheDocument();
  });
});