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

/** Builds the required React Flow node-card contract for focused interaction tests. */
const nodeData = (
  node: Partial<{
    id: string;
    name: string;
    color: string | null;
    shape: [number | null, number | null];
    canUndo: boolean;
    canRedo: boolean;
  }> = {},
) => ({
  node: {
    id: 'node-1',
    name: 'Corpus',
    color: null,
    shape: [10, 3] as [number | null, number | null],
    canUndo: false,
    canRedo: false,
    ...node,
  },
  isFresh: false,
  onDelete: vi.fn(),
  onRename: vi.fn(),
  onCopy: vi.fn(),
  onUndo: vi.fn(),
  onRedo: vi.fn(),
  onAddToSelection: vi.fn(),
});

describe('CustomNode', () => {
  it('removes the save action from the node menu', async () => {
    mockZoom = 1;
    const user = userEvent.setup();
    const props = {
      id: 'node-1',
      type: 'custom',
      data: nodeData({
        name: 'sample_data/ADO/qldelection2020_candidate_tweets',
        shape: [480, 8],
        canUndo: true,
      }),
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

  it('paints a left color accent on the card when the node has a color', () => {
    mockZoom = 1;
    const props = {
      id: 'node-1',
      type: 'custom',
      data: nodeData({ color: '#2563eb' }),
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

    const card = screen.getByTestId('custom-node-card');
    expect(card).toHaveStyle({ borderLeftWidth: '6px' });
    expect(card.style.borderLeftColor).not.toBe('');
  });

  it('marks the rename input as non-draggable so React Flow does not intercept clicks', async () => {
    mockZoom = 1;
    const user = userEvent.setup();
    const props = {
      id: 'node-1',
      type: 'custom',
      data: nodeData({
        name: 'sample_data/ADO/qldelection2020_samidata_tweets',
        shape: [2380, 15],
      }),
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
          ...nodeData({
            id: 'node-zoomed-out',
            name: 'sample_data/ADO/qldelection2020_candidate_tweets',
            shape: [480, 8],
            canUndo: true,
          }),
          onDelete,
          onRename,
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

  it('hides the node toolbar immediately when the pointer leaves the node', async () => {
    // Regression guard: the toolbar must vanish instantly on mouse-out with no
    // grace-period timer. `user.unhover` does not advance any long timer, so a
    // reintroduced hide delay would keep the button mounted and fail this test.
    mockZoom = 1;
    const user = userEvent.setup();
    const props = {
      id: 'node-hide',
      type: 'custom',
      data: nodeData({
        id: 'node-hide',
        name: 'sample_data/ADO/qldelection2020_candidate_tweets',
        shape: [480, 8],
      }),
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

    const nodeLabel = screen.getByTitle('sample_data/ADO/qldelection2020_candidate_tweets');
    await user.hover(nodeLabel);
    expect(getLatestNodeSettingsButton()).toBeInTheDocument();

    await user.unhover(nodeLabel);
    expect(screen.queryAllByRole('button', { name: /node settings/i })).toHaveLength(0);
  });

  it('counter-scales the fresh "new" dot so it stays a constant size when zoomed out', () => {
    // Regression guard: the red "new" dot lives inside the zoom-scaled node, so
    // without an inverse-scale transform it would shrink to near-invisible at low
    // zoom. At zoom 0.2 the dot must cancel the viewport with scale(5) and keep a
    // constant 4px corner poke-out (translate 20px = 4px * 5) so it reads the same
    // on screen as the fixed-size NodeToolbar menu.
    mockZoom = 0.2;

    render(
      <CustomNode
        id="node-fresh"
        type="custom"
        data={{ ...nodeData({ id: 'node-fresh', name: 'Fresh corpus' }), isFresh: true }}
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

    const dot = screen.getByTitle('New data block');
    expect(dot.style.transform).toContain('scale(5)');
    expect(dot.style.transform).toContain('translate(20px, -20px)');
  });
});
