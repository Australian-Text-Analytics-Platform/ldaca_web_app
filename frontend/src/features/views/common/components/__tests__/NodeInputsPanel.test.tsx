import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Field, Utf8 } from 'apache-arrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { projectWorkspaceNodeMetadata } from '@/features/workspace/common/workspaceNodeMetadata';
import type { NodeInputRequestsStore } from '@/stores/nodeInputRequestsStore';
import { NodeInputsPanel } from '../NodeInputsPanel';

const mocks = vi.hoisted(() => ({
  useWorkspaceData: vi.fn(),
  useUIStore: vi.fn(),
  useNodeInputRequestsStore: vi.fn(),
}));

vi.mock('@/features/workspace/common/hooks/useWorkspaceData', () => ({
  useWorkspaceData: mocks.useWorkspaceData,
}));

vi.mock('@/stores', () => ({
  useUIStore: mocks.useUIStore,
}));

vi.mock('@/stores/nodeInputRequestsStore', () => ({
  useNodeInputRequestsStore: mocks.useNodeInputRequestsStore,
}));

const resolvedNodes = [
  {
    id: 'node-1',
    name: 'Corpus A',
    node: projectWorkspaceNodeMetadata(
      { id: 'node-1', name: 'Corpus A' },
      { id: 'node-1', name: 'Corpus A', shape: [100, 2] },
    ),
    column: 'body',
    columnOptions: [{ name: 'body', typeName: 'Utf8', field: new Field('body', new Utf8()) }],
  },
];

const baseProps = {
  resolvedNodes,
  availableNodes: [],
  canAddMore: true,
  onAddNodes: vi.fn(() => []),
  onRemoveNode: vi.fn(),
  onClear: vi.fn(),
  onColumnChange: vi.fn(),
};

function nodeInputRequestsStore(
  overrides: Partial<NodeInputRequestsStore> = {},
): NodeInputRequestsStore {
  const store: NodeInputRequestsStore = {
    nextId: 1,
    pendingRequests: [],
    requestAdd: vi.fn(),
    consume: vi.fn(),
    clear: vi.fn(),
    ...overrides,
  };
  mocks.useNodeInputRequestsStore.mockImplementation(
    (selector: (state: NodeInputRequestsStore) => unknown) => selector(store),
  );
  return store;
}

describe('NodeInputsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useWorkspaceData.mockReturnValue({ currentWorkspaceId: 'workspace-1' });
    mocks.useUIStore.mockImplementation((selector: (state: { currentView: string }) => unknown) =>
      selector({ currentView: 'annotation' }),
    );
    nodeInputRequestsStore();
  });

  it('keeps its guidance anchor clear of analysis tab chrome when Joyride scrolls to it', () => {
    render(
      <NodeInputsPanel
        {...baseProps}
        title="Concordance inputs"
        guidanceTarget="concordance-inputs"
      />,
    );

    expect(screen.getByRole('group', { name: 'Concordance inputs controls' })).toHaveClass(
      'scroll-mt-16',
    );
    expect(screen.getByRole('group', { name: 'Concordance inputs controls' })).toHaveAttribute(
      'data-guidance',
      'concordance-inputs',
    );
  });

  it('lets auto-width column add-ons give remaining row space to the column selector', () => {
    render(
      <NodeInputsPanel
        {...baseProps}
        columnAddonWidth="auto"
        nodeColors={{ 'node-1': '#2563eb' }}
        onNodeColorChange={vi.fn()}
        renderColumnAddon={() => <div data-testid="column-addon">Sampling</div>}
      />,
    );

    expect(screen.getByTestId('column-addon')).toBeInTheDocument();
    expect(screen.getByTestId('node-inputs-actions')).toHaveClass(
      '@max-[430px]/node-inputs:basis-full',
    );
    expect(screen.getByTestId('node-inputs-column-addon')).toHaveClass('w-max');
    expect(screen.getByTestId('node-inputs-controls')).toHaveClass(
      'md:grid-cols-[minmax(0,1fr)_auto_auto]',
    );
  });

  it('shows an always-visible horizontal scrollbar when selected cards overflow', () => {
    render(
      <NodeInputsPanel
        {...baseProps}
        resolvedNodes={[
          resolvedNodes[0]!,
          { ...resolvedNodes[0]!, id: 'node-2', name: 'Corpus B' },
          { ...resolvedNodes[0]!, id: 'node-3', name: 'Corpus C' },
        ]}
        maxVisibleCards={2}
      />,
    );

    const scrollArea = screen.getByTestId('node-selection-scroll-area');
    // Radix scrollbars do not expose a semantic role to query through Testing Library.
    // eslint-disable-next-line testing-library/no-node-access
    const horizontalScrollbar = scrollArea.querySelector(
      '[data-slot="scroll-area-scrollbar"][data-orientation="horizontal"]',
    );
    expect(horizontalScrollbar).toHaveAttribute('data-state', 'visible');
  });

  it('keeps a deleted saved input visible as an unavailable Data Block card', async () => {
    const user = userEvent.setup();
    const onRemoveNode = vi.fn();

    render(
      <NodeInputsPanel
        {...baseProps}
        resolvedNodes={[]}
        unavailableNodes={[{ id: 'deleted-node', name: 'Archived Corpus', column: 'body' }]}
        inputOrder={['deleted-node']}
        maxNodes={2}
        onRemoveNode={onRemoveNode}
      />,
    );

    expect(screen.getByText('Selected Data Blocks (1/2)')).toBeInTheDocument();
    const card = screen.getByRole('group', { name: 'Archived Corpus unavailable' });
    expect(within(card).getByText('Archived Corpus')).toBeInTheDocument();
    expect(
      within(card).getByText(
        'This Data Block no longer exists in the Workspace and cannot be used for a new run.',
      ),
    ).toBeInTheDocument();
    expect(within(card).getByText('body')).toBeInTheDocument();
    expect(screen.queryByText('No data blocks selected.')).not.toBeInTheDocument();

    await user.click(within(card).getByRole('button', { name: 'Remove Archived Corpus' }));
    expect(onRemoveNode).toHaveBeenCalledWith('deleted-node');
  });

  it('places and consumes only the latest matching carried Data Block', async () => {
    const user = userEvent.setup();
    const onAddNodes = vi.fn(() => []);
    const consume = vi.fn();
    nodeInputRequestsStore({
      pendingRequests: [
        { id: 4, workspaceId: 'workspace-1', view: 'annotation', nodeId: 'node-a' },
        { id: 5, workspaceId: 'workspace-1', view: 'annotation', nodeId: 'node-b' },
      ],
      consume,
    });

    render(<NodeInputsPanel {...baseProps} title="Example Node" onAddNodes={onAddNodes} />);

    const target = screen.getByRole('button', { name: 'Add to Example Node' });
    expect(target).toHaveClass('justify-center');
    await user.click(target);

    expect(onAddNodes).toHaveBeenCalledWith(['node-b']);
    expect(consume).toHaveBeenCalledWith(5);
  });

  it('marks a filled pending-request target as unavailable and directs users elsewhere', () => {
    const onAddNodes = vi.fn(() => []);
    nodeInputRequestsStore({
      pendingRequests: [
        { id: 4, workspaceId: 'workspace-1', view: 'annotation', nodeId: 'node-a' },
      ],
    });

    render(
      <NodeInputsPanel
        {...baseProps}
        title="Example Node"
        canAddMore={false}
        onAddNodes={onAddNodes}
      />,
    );

    const target = screen.getByRole('button', { name: 'Example Node is already filled' });
    expect(target).toBeDisabled();
    expect(target).toHaveClass('justify-center');
    expect(
      screen.getByText('This selector is already filled. Choose another selector.'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('filled-selector-stop-icon')).toBeInTheDocument();
    expect(onAddNodes).not.toHaveBeenCalled();
  });

  it('discards the latest carried Data Block without adding it', async () => {
    const user = userEvent.setup();
    const onAddNodes = vi.fn(() => []);
    const consume = vi.fn();
    nodeInputRequestsStore({
      pendingRequests: [
        { id: 4, workspaceId: 'workspace-1', view: 'annotation', nodeId: 'node-a' },
      ],
      consume,
    });

    render(<NodeInputsPanel {...baseProps} title="Example Node" onAddNodes={onAddNodes} />);

    await user.click(screen.getByRole('button', { name: 'Discard latest carried Data Block' }));

    expect(onAddNodes).not.toHaveBeenCalled();
    expect(consume).toHaveBeenCalledWith(4);
  });

  it('keeps the latest Data Block carried when placement is rejected', async () => {
    const user = userEvent.setup();
    const onAddNodes = vi.fn(() => [{ nodeId: 'node-a', reason: 'Already selected' }]);
    const consume = vi.fn();
    nodeInputRequestsStore({
      pendingRequests: [
        { id: 4, workspaceId: 'workspace-1', view: 'annotation', nodeId: 'node-a' },
      ],
      consume,
    });

    render(<NodeInputsPanel {...baseProps} title="Example Node" onAddNodes={onAddNodes} />);
    await user.click(screen.getByRole('button', { name: 'Add to Example Node' }));

    expect(onAddNodes).toHaveBeenCalledWith(['node-a']);
    expect(consume).not.toHaveBeenCalled();
  });
});
