import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import CustomNode from '../CustomNode';
import { GREY } from '@/features/views/common/vizPalette';
import { toNodeSurfaceColor } from '@/lib/nodeColor';

const mocks = vi.hoisted(() => ({
  downloadDataBlocks: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock('@/features/workspace/common/dataBlockExport', () => ({
  DATA_BLOCK_EXPORT_FORMATS: [
    { value: 'csv', label: 'CSV (.csv)', extension: 'csv' },
    { value: 'json', label: 'JSON (.json)', extension: 'json' },
  ],
  downloadDataBlocks: mocks.downloadDataBlocks,
}));
vi.mock('sonner', () => ({ toast: mocks.toast }));
vi.mock('@/features/workspace/common/hooks/useWorkspaceData', () => ({
  useWorkspaceData: () => ({
    currentWorkspaceId: 'workspace-1',
    currentWorkspace: { name: 'Main Workspace' },
  }),
}));

let mockZoom = 1;

vi.mock('@xyflow/react', () => ({
  /**
   * Stubs React Flow handles so CustomNode can render outside a graph canvas.
   */
  Handle: () => <div data-testid="handle" />,
  Position: { Left: 'left', Right: 'right' },
  /**
   * Lets tests control zoom-dependent rendering without a React Flow store.
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
 */
const getLatestNodeSettingsButton = () => {
  const buttons = screen.getAllByRole('button', { name: /data block actions/i });
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
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.downloadDataBlocks.mockResolvedValue('Corpus.csv');
  });

  it('starts pointer-carry placement from the node add button', async () => {
    mockZoom = 1;
    const user = userEvent.setup();
    const data = nodeData();
    const props = {
      id: 'node-1',
      type: 'custom',
      data,
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

    await user.hover(screen.getByTitle('Corpus'));
    const card = screen.getByTestId('custom-node-card');
    expect(card).not.toHaveClass('ring-1', 'ring-inset', 'ring-focus');
    fireEvent.click(screen.getByRole('button', { name: 'Add Data Block to selection' }), {
      clientX: 180,
      clientY: 220,
      detail: 1,
    });

    expect(data.onAddToSelection).toHaveBeenCalledWith('node-1', { x: 180, y: 220 });
  });

  it('shows Undo and Redo from backend history flags without restoring Save', async () => {
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
    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(props.data.onUndo).toHaveBeenCalledWith('node-1');
  });

  it('opens single-Data-Block export from the node menu', async () => {
    mockZoom = 1;
    const user = userEvent.setup();
    const props = {
      id: 'node-1',
      type: 'custom',
      data: nodeData(),
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

    await user.hover(screen.getByTitle('Corpus'));
    fireEvent.click(getLatestNodeSettingsButton());
    await user.click(screen.getByRole('button', { name: 'Export' }));

    expect(screen.getByRole('heading', { name: 'Export “Corpus”' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Export format' })).toHaveTextContent('CSV');
    await user.click(screen.getByRole('button', { name: 'Export' }));

    await waitFor(() =>
      expect(mocks.downloadDataBlocks).toHaveBeenCalledWith({
        workspaceId: 'workspace-1',
        workspaceName: 'Main Workspace',
        dataBlocks: [{ id: 'node-1', name: 'Corpus' }],
        format: 'csv',
      }),
    );
  });

  it('keeps the export dialog open when Save As is cancelled', async () => {
    mockZoom = 1;
    const user = userEvent.setup();
    mocks.downloadDataBlocks.mockResolvedValueOnce(null);
    const props = {
      id: 'node-1',
      type: 'custom',
      data: nodeData(),
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

    await user.hover(screen.getByTitle('Corpus'));
    fireEvent.click(getLatestNodeSettingsButton());
    await user.click(screen.getByRole('button', { name: 'Export' }));
    await user.click(screen.getByRole('button', { name: 'Export' }));

    await waitFor(() => expect(mocks.downloadDataBlocks).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('heading', { name: 'Export “Corpus”' })).toBeInTheDocument();
    expect(mocks.toast.success).not.toHaveBeenCalled();
  });

  it('uses a toned identity header and a detached selection outline', () => {
    mockZoom = 1;
    const props = {
      id: 'node-1',
      type: 'custom',
      data: nodeData({ color: '#2563eb' }),
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

    const card = screen.getByTestId('custom-node-card');
    const identityHeader = screen.getByTestId('custom-node-identity-header');
    expect(card).toHaveClass(
      'w-80',
      'outline-2',
      'outline-offset-2',
      'outline-data-block-selection',
    );
    expect(card.style.borderLeftWidth).toBe('');
    expect(identityHeader).toHaveStyle({ backgroundColor: toNodeSurfaceColor('#2563eb') });
    expect(identityHeader).toHaveClass('text-foreground');
    expect(identityHeader.style.color).toBe('');
    expect(screen.getByTitle('Corpus')).toHaveClass('max-h-[3lh]');
  });

  it('opens the shared Data Block rename dialog from the full node menu', async () => {
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

    const dialog = screen.getByRole('alertdialog');
    const renameInput = screen.getByRole('textbox', { name: 'New Data Block name' });

    await waitFor(() => expect(renameInput).toHaveFocus());
    expect(dialog).toHaveClass('w-[calc(100vw-2rem)]', 'min-w-0', 'max-w-lg');
    expect(screen.getByRole('heading', { name: 'Rename Data Block' })).toBeInTheDocument();
    expect(renameInput).toHaveValue('sample_data/ADO/qldelection2020_samidata_tweets');
    expect(renameInput).toHaveClass('border-input-border', 'focus-visible:border-focus');
    expect(renameInput).not.toHaveClass('focus:ring-blue-500');
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

    const compactCard = screen.getByTestId('custom-node-compact-card');
    expect(compactCard).toHaveStyle({
      minWidth: '220px',
      maxWidth: '360px',
      backgroundColor: toNodeSurfaceColor(GREY),
    });
    expect(compactCard).toHaveClass('text-foreground');
    expect(compactCard).toHaveClass(
      'outline-2',
      'outline-offset-2',
      'outline-data-block-selection',
    );
    expect(screen.getByTitle('sample_data/ADO/qldelection2020_candidate_tweets')).toHaveClass(
      'max-h-[3lh]',
    );
    expect(screen.getByTitle('sample_data/ADO/qldelection2020_candidate_tweets')).toHaveClass(
      'flex',
      'flex-col',
      'justify-end',
    );
    const compactHeadFade = screen.getByTestId('data-block-name-head-fade');
    expect(compactHeadFade).toHaveClass('inset-x-0', 'top-0');

    fireEvent.click(getLatestNodeSettingsButton());
    expect(screen.getByRole('button', { name: 'Rename' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByText(/This action cannot be undone/)).toBeInTheDocument();
  });

  it('renames from the zoomed-out node menu', async () => {
    mockZoom = 0.59;
    const user = userEvent.setup();
    const onRename = vi.fn();
    const handleNodeClick = vi.fn((event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
    });
    const name = 'sample_data/ADO/qldelection2020_candidate_tweets';

    render(
      <div onClick={handleNodeClick}>
        <CustomNode
          id="node-zoomed-out"
          type="custom"
          data={{
            ...nodeData({ id: 'node-zoomed-out', name }),
            onRename,
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
      </div>,
    );

    await user.hover(screen.getByTitle(name));
    fireEvent.click(getLatestNodeSettingsButton());
    await user.click(screen.getByRole('button', { name: 'Rename' }));

    const renameInput = await screen.findByRole('textbox', { name: 'New Data Block name' });
    await waitFor(() => expect(renameInput).toHaveFocus());
    expect(screen.getByRole('heading', { name: 'Rename Data Block' })).toBeInTheDocument();
    await user.clear(renameInput);
    await user.type(renameInput, 'Renamed Data Block');
    await user.click(screen.getByRole('button', { name: 'Rename' }));

    expect(onRename).toHaveBeenCalledWith('node-zoomed-out', 'Renamed Data Block');
    expect(screen.queryByRole('textbox', { name: 'New Data Block name' })).not.toBeInTheDocument();
    expect(handleNodeClick).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('custom-node-compact-card'));
    expect(handleNodeClick).toHaveBeenCalledOnce();
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
    expect(screen.queryAllByRole('button', { name: /data block actions/i })).toHaveLength(0);
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
