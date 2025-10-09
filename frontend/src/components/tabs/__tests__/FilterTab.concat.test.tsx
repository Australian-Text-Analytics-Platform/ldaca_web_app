import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const selectionState = {
  selectedNodeId: null as string | null,
  selectedNode: null as Record<string, unknown> | null,
  selectedNodes: [] as Array<Record<string, unknown>>,
  selectedNodeIds: [] as string[],
};

const workspaceDataState = {
  nodeData: {} as Record<string, unknown>,
  currentWorkspaceId: 'workspace-1',
  nodes: [] as Array<Record<string, unknown>>, 
  getNodeShape: vi.fn(),
};

const actionsState = {
  filterNode: vi.fn(),
  filterPreview: vi.fn(),
  joinNodes: vi.fn(),
  concatNodes: vi.fn(),
  concatPreview: vi.fn().mockResolvedValue({
    data: [],
    columns: [],
    dtypes: {},
    pagination: {
      page: 1,
      page_size: 10,
      total_rows: 0,
      total_pages: 0,
      has_next: false,
      has_prev: false,
    },
  }),
};

const statusState = {
  isLoading: {
    workspaces: false,
    currentWorkspace: false,
    nodes: false,
    graph: false,
    nodeData: false,
    operations: false,
  },
};

vi.mock('../../../hooks/useWorkspaceSelection', () => ({
  useWorkspaceSelection: () => selectionState,
}));

vi.mock('../../../hooks/useWorkspaceData', () => ({
  useWorkspaceData: () => workspaceDataState,
}));

vi.mock('../../../hooks/useWorkspaceActions', () => ({
  useWorkspaceActions: () => actionsState,
}));

vi.mock('../../../hooks/useWorkspaceStatus', () => ({
  useWorkspaceStatus: () => statusState,
}));

import FilterTab from '../FilterTab';

describe('FilterTab concat workflow', () => {
  beforeEach(() => {
    selectionState.selectedNodeId = null;
    selectionState.selectedNode = null;
    selectionState.selectedNodes = [];
    selectionState.selectedNodeIds = [];

    workspaceDataState.nodes = [];

    actionsState.filterNode.mockReset();
    actionsState.filterPreview.mockReset();
    actionsState.joinNodes.mockReset();
    actionsState.concatNodes.mockReset();
    actionsState.concatPreview.mockReset().mockResolvedValue({
      data: [],
      columns: [],
      dtypes: {},
      pagination: {
        page: 1,
        page_size: 10,
        total_rows: 0,
        total_pages: 0,
        has_next: false,
        has_prev: false,
      },
    });

    statusState.isLoading.operations = false;

    vi.useRealTimers();
  });

  it('enables concat submission when schemas align and calls concatNodes with selected IDs', async () => {
    const nodeA = {
      id: 'node_a',
      name: 'Node A',
      data: {
        columns: ['id', 'text'],
        dtypes: { id: 'Int64', text: 'Utf8' },
      },
    };
    const nodeB = {
      id: 'node_b',
      name: 'Node B',
      data: {
        columns: ['text', 'id'],
        dtypes: { id: 'Int64', text: 'Utf8' },
      },
    };

    selectionState.selectedNodeIds = ['node_a', 'node_b'];
    selectionState.selectedNodes = [nodeA, nodeB];
    workspaceDataState.nodes = [nodeA, nodeB];

    vi.useFakeTimers();

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    render(<FilterTab />);

    await user.click(screen.getByRole('tab', { name: 'Concat' }));

    await act(async () => {
      vi.advanceTimersByTime(650);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(actionsState.concatPreview).toHaveBeenCalled();

    const statusText = screen.getByText(/Ready to concatenate 2 nodes/);
    expect(statusText).toBeInTheDocument();

    const addButton = screen.getByRole('button', { name: 'Add to Workspace' });
    expect(addButton).toBeEnabled();

    await act(async () => {
      await user.click(addButton);
    });

    expect(actionsState.concatNodes).toHaveBeenCalledTimes(1);
    expect(actionsState.concatNodes).toHaveBeenCalledWith(
      ['node_a', 'node_b'],
      'Concat(Node A, Node B)'
    );
  });

  it('disables concat submission and surfaces mismatch details when schemas differ', async () => {
    const nodeA = {
      id: 'node_a',
      name: 'Node A',
      data: {
        columns: ['id', 'text'],
        dtypes: { id: 'Int64', text: 'Utf8' },
      },
    };
    const nodeC = {
      id: 'node_c',
      name: 'Node C',
      data: {
        columns: ['id', 'text', 'extra'],
        dtypes: { id: 'Int64', text: 'Utf8', extra: 'Utf8' },
      },
    };

    selectionState.selectedNodeIds = ['node_a', 'node_c'];
    selectionState.selectedNodes = [nodeA, nodeC];
    workspaceDataState.nodes = [nodeA, nodeC];

    vi.useFakeTimers();

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    render(<FilterTab />);

    await user.click(screen.getByRole('tab', { name: 'Concat' }));

    await act(async () => {
      vi.advanceTimersByTime(650);
    });
    await act(async () => {
      await Promise.resolve();
    });

    const mismatchAlert = screen.getByText(/Schema mismatches detected/);
    expect(mismatchAlert).toBeInTheDocument();
    expect(screen.getByText(/Extra columns: extra/i)).toBeInTheDocument();

    const addButton = screen.getByRole('button', { name: 'Add to Workspace' });
    expect(addButton).toBeDisabled();
    expect(actionsState.concatNodes).not.toHaveBeenCalled();
  });
});
