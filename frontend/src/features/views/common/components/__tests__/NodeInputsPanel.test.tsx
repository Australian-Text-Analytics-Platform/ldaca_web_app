import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    node: { id: 'node-1', name: 'Corpus A', shape: [100, 2] },
    column: 'body',
    columnOptions: [{ name: 'body', dataType: 'string' }],
  },
];

const baseProps = {
  resolvedNodes,
  availableNodes: [],
  canAddMore: true,
  onAddNodes: vi.fn(() => []),
  getAddRejection: vi.fn(() => null),
  onRemoveNode: vi.fn(),
  onClear: vi.fn(),
  onColumnChange: vi.fn(),
};

function nodeInputRequestsStore(
  overrides: Partial<NodeInputRequestsStore> = {},
): NodeInputRequestsStore {
  const store: NodeInputRequestsStore = {
    nextId: 1,
    requests: [],
    requestAdd: vi.fn(),
    consume: vi.fn(),
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
    expect(screen.getByTestId('node-inputs-column-addon')).toHaveClass('w-max');
    expect(screen.getByTestId('node-inputs-controls')).toHaveClass(
      'md:grid-cols-[minmax(0,1fr)_auto_auto]',
    );
  });

  it('renders a dashed add target for matching pending requests', async () => {
    const user = userEvent.setup();
    const onAddNodes = vi.fn(() => []);
    const consume = vi.fn();
    nodeInputRequestsStore({
      requests: [
        { id: 4, workspaceId: 'workspace-1', view: 'annotation', nodeIds: ['node-a', 'node-b'] },
      ],
      consume,
    });

    render(<NodeInputsPanel {...baseProps} title="Example Node" onAddNodes={onAddNodes} />);

    await user.click(screen.getByRole('button', { name: 'Add to Example Node' }));

    expect(onAddNodes).toHaveBeenCalledWith(['node-a', 'node-b']);
    expect(consume).toHaveBeenCalledWith(4);
  });

  it('cancels a pending dashed add target without adding nodes', async () => {
    const user = userEvent.setup();
    const onAddNodes = vi.fn(() => []);
    const consume = vi.fn();
    nodeInputRequestsStore({
      requests: [{ id: 4, workspaceId: 'workspace-1', view: 'annotation', nodeIds: ['node-a'] }],
      consume,
    });

    render(<NodeInputsPanel {...baseProps} title="Example Node" onAddNodes={onAddNodes} />);

    await user.click(screen.getByRole('button', { name: 'Cancel adding node' }));

    expect(onAddNodes).not.toHaveBeenCalled();
    expect(consume).toHaveBeenCalledWith(4);
  });
});
