import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import CustomNode from '../CustomNode';

let mockZoom = 1;

vi.mock('@xyflow/react', () => ({
  /**
   * Stubs React Flow handles so CustomNode can render outside a graph canvas.
   * Used by: test mock object in workspace/CustomNode.
   * Why: because the mock needs the production-shaped dependency while the test isolates this feature path.
   */
  Handle: () => <div data-testid="handle" />,
  Position: { Left: 'left', Right: 'right' },
  /**
   * Lets tests control zoom-dependent rendering without a React Flow store.
   * Used by: test mock object in workspace/CustomNode.
   * Why: because the mock needs the production-shaped dependency while the test isolates this feature path.
   */
  useStore: (selector: (state: { transform: [number, number, number] }) => number) =>
    selector({ transform: [0, 0, mockZoom] }),
  /** Renders toolbar children when visible, forwarding wrapper event props. */
  NodeToolbar: ({
    children,
    isVisible,
    nodeId: _nodeId,
    ...props
  }: React.HTMLAttributes<HTMLDivElement> & {
    children: React.ReactNode;
    isVisible?: boolean;
    nodeId?: string;
  }) =>
    isVisible ? (
      <div data-testid="node-toolbar" {...props}>
        {children}
      </div>
    ) : null,
}));

/**
 * Returns the visible settings button when portal/menu render duplicates occur.
 * Used by: Vitest setup or assertions in workspace/CustomNode.
 * Why: because the test needs a stable fixture or assertion target for this scoped behavior without live workspace state.
 */
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
      selected: true,
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

    await user.hover(screen.getByTitle('sample_data/ADO/qldelection2020_candidate_tweets'));
    fireEvent.click(getLatestNodeSettingsButton());

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
      selected: true,
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

    await user.hover(screen.getByTitle('sample_data/ADO/qldelection2020_samidata_tweets'));
    fireEvent.click(getLatestNodeSettingsButton());
    await user.click(screen.getByRole('button', { name: 'Rename' }));

    const renameInputs = screen.getAllByDisplayValue(
      'sample_data/ADO/qldelection2020_samidata_tweets',
    );
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
        selected={true}
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

    await user.hover(screen.getByTitle('sample_data/ADO/qldelection2020_candidate_tweets'));
    expect(screen.queryByText(/Shape:/)).not.toBeInTheDocument();
    expect(getLatestNodeSettingsButton()).toBeInTheDocument();

    fireEvent.click(getLatestNodeSettingsButton());
    expect(screen.getByRole('button', { name: 'Rename' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByText(/This action cannot be undone/)).toBeInTheDocument();
  });
});
