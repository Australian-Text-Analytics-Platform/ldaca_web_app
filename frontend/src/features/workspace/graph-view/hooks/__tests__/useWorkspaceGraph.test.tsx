import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSelectionStore } from '@/stores/selectionStore';
import { useFreshNodesStore } from '@/stores/freshNodesStore';

const useWorkspaceDataMock = vi.hoisted(() => vi.fn());
const useWorkspaceSelectionMock = vi.hoisted(() => vi.fn());
const useWorkspaceStatusMock = vi.hoisted(() => vi.fn());
const useWorkspaceActionsMock = vi.hoisted(() => vi.fn());
const requestNodeInputAddMock = vi.hoisted(() => vi.fn());
const undoNode = vi.fn();
const redoNode = vi.fn();

vi.mock('@/features/workspace/common/hooks/useWorkspaceData', () => ({
  useWorkspaceData: useWorkspaceDataMock,
}));
vi.mock('@/features/workspace/common/hooks/useWorkspaceSelection', () => ({
  useWorkspaceSelection: useWorkspaceSelectionMock,
}));
vi.mock('@/features/workspace/common/hooks/useWorkspaceStatus', () => ({
  useWorkspaceStatus: useWorkspaceStatusMock,
}));
vi.mock('@/features/workspace/common/hooks/useWorkspaceActions', () => ({
  useWorkspaceActions: useWorkspaceActionsMock,
}));
vi.mock('@/stores/nodeInputRequestsStore', () => ({
  useNodeInputRequestsStore: (
    selector: (state: { requestAdd: typeof requestNodeInputAddMock }) => unknown,
  ) => selector({ requestAdd: requestNodeInputAddMock }),
}));
vi.mock('../../services/graphLayout', () => ({
  computeDagreLayout: (nodes: { id: string }[]) =>
    new Map(
      nodes.map((node, index) => [node.id, { x: 0, y: (nodes.length - index - 1) * 100 + 50 }]),
    ),
}));

import { useWorkspaceGraph } from '../useWorkspaceGraph';

const makeGraph = (
  color: string,
  edgeLabel: string,
  shape: [number | null, number | null] = [10, 3],
) => ({
  nodes: [
    {
      id: 'node-1',
      name: 'Node one',
      color,
      shape,
      document: 'text',
      can_undo: false,
      can_redo: true,
    },
  ],
  edges: [{ source: 'node-1', target: 'node-1', label: edgeLabel }],
});

const makeIndependentGraph = (nodeIds: string[]) => ({
  nodes: nodeIds.map((id) => ({
    id,
    name: id,
    color: null,
    document: 'text',
    can_undo: false,
    can_redo: false,
  })),
  edges: [],
});

interface TestNodeData {
  node: {
    color: string | null;
    shape: [number | null, number | null];
    canUndo: boolean;
    canRedo: boolean;
  };
  isFresh: boolean;
  onUndo: (nodeId: string) => void;
  onRedo: (nodeId: string) => void;
  onAddToSelection: (nodeId: string, pointer?: { x: number; y: number }) => void;
}

describe('useWorkspaceGraph', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    requestNodeInputAddMock.mockReset();
    undoNode.mockReset();
    redoNode.mockReset();
    useFreshNodesStore.getState().reset();
    useSelectionStore.setState({ currentWorkspaceId: 'workspace-a' });
    useWorkspaceDataMock.mockReturnValue({
      currentWorkspaceId: 'workspace-a',
      workspaceGraph: makeGraph('#ff0000', 'first label'),
    });
    useWorkspaceSelectionMock.mockReturnValue({ selectedNodeIds: [] });
    useWorkspaceStatusMock.mockReturnValue({ isLoading: { graph: false } });
    useWorkspaceActionsMock.mockReturnValue({
      deleteNode: vi.fn(),
      copyNode: vi.fn(),
      renameNode: vi.fn(),
      undoNode,
      redoNode,
      toggleNode: vi.fn(),
      toggleNodeSelection: vi.fn(),
      clearSelection: vi.fn(),
    });
  });

  it('resynchronizes node colour and edge label when topology is unchanged', () => {
    const { result, rerender } = renderHook(() => useWorkspaceGraph());

    expect((result.current.nodes[0]?.data as unknown as TestNodeData).node.color).toBe('#ff0000');
    expect(result.current.edges[0]?.label).toBe('first label');

    useWorkspaceDataMock.mockReturnValue({
      currentWorkspaceId: 'workspace-a',
      workspaceGraph: makeGraph('#0000ff', 'second label'),
    });
    rerender();

    expect((result.current.nodes[0]?.data as unknown as TestNodeData).node.color).toBe('#0000ff');
    expect(result.current.edges[0]?.label).toBe('second label');
  });

  it('shows no new marker for loaded nodes and shows one only after explicit creation', () => {
    const { result, rerender } = renderHook(() => useWorkspaceGraph());

    expect((result.current.nodes[0]?.data as unknown as TestNodeData).isFresh).toBe(false);

    act(() => {
      useFreshNodesStore.getState().markCreated('workspace-a', ['node-1']);
    });
    rerender();

    expect((result.current.nodes[0]?.data as unknown as TestNodeData).isFresh).toBe(true);
  });

  it('projects history flags and routes graph history commands', () => {
    const { result } = renderHook(() => useWorkspaceGraph());
    const data = result.current.nodes[0]?.data as unknown as TestNodeData;

    expect(data.node.canUndo).toBe(false);
    expect(data.node.canRedo).toBe(true);
    act(() => {
      data.onUndo('node-1');
      data.onRedo('node-1');
    });
    expect(undoNode).toHaveBeenCalledWith('node-1');
    expect(redoNode).toHaveBeenCalledWith('node-1');
  });

  it('preserves a dragged position while refreshing node and edge presentation', () => {
    const { result, rerender } = renderHook(() => useWorkspaceGraph());
    const draggedPosition = { x: 420, y: 315 };

    act(() => {
      result.current.handleNodesChange([
        {
          id: 'node-1',
          type: 'position',
          position: draggedPosition,
          dragging: true,
        },
      ]);
    });
    expect(result.current.nodes[0]?.position).toEqual(draggedPosition);

    useWorkspaceDataMock.mockReturnValue({
      currentWorkspaceId: 'workspace-a',
      workspaceGraph: makeGraph('#0000ff', 'second label', [20, 4]),
    });
    rerender();

    expect(result.current.nodes[0]?.position).toEqual(draggedPosition);
    expect(result.current.nodes[0]?.dragging).toBe(true);
    const refreshedNode = (result.current.nodes[0]?.data as unknown as TestNodeData).node;
    expect(refreshedNode.color).toBe('#0000ff');
    expect(refreshedNode.shape).toEqual([20, 4]);
    expect(result.current.edges[0]?.label).toBe('second label');
  });

  it('re-applies the complete layout when a Data Block is added', () => {
    useWorkspaceDataMock.mockReturnValue({
      currentWorkspaceId: 'workspace-a',
      workspaceGraph: makeIndependentGraph(['node-1']),
    });
    const { result, rerender } = renderHook(() => useWorkspaceGraph());

    expect(result.current.nodes[0]?.position).toEqual({ x: 0, y: 50 });

    useWorkspaceDataMock.mockReturnValue({
      currentWorkspaceId: 'workspace-a',
      workspaceGraph: makeIndependentGraph(['node-1', 'node-2']),
    });
    rerender();

    expect(result.current.nodes.map((node) => node.position)).toEqual([
      { x: 0, y: 150 },
      { x: 0, y: 50 },
    ]);
  });

  it('re-applies the complete layout when Data Block lineage changes', () => {
    useWorkspaceDataMock.mockReturnValue({
      currentWorkspaceId: 'workspace-a',
      workspaceGraph: makeIndependentGraph(['node-1', 'node-2']),
    });
    const { result, rerender } = renderHook(() => useWorkspaceGraph());

    act(() => {
      result.current.handleNodesChange([
        {
          id: 'node-1',
          type: 'position',
          position: { x: 420, y: 315 },
          dragging: true,
        },
      ]);
    });

    useWorkspaceDataMock.mockReturnValue({
      currentWorkspaceId: 'workspace-a',
      workspaceGraph: {
        ...makeIndependentGraph(['node-1', 'node-2']),
        edges: [{ source: 'node-1', target: 'node-2', label: 'derived' }],
      },
    });
    rerender();

    expect(result.current.nodes[0]?.position).toEqual({ x: 0, y: 150 });
    expect(result.current.nodes[0]?.dragging).toBeUndefined();
  });

  it('resets React Flow-owned state when a new workspace reuses the same node id', () => {
    const { result, rerender } = renderHook(() => useWorkspaceGraph());

    act(() => {
      result.current.handleNodesChange([
        {
          id: 'node-1',
          type: 'position',
          position: { x: 420, y: 315 },
          dragging: true,
        },
      ]);
    });

    useSelectionStore.setState({ currentWorkspaceId: 'workspace-b' });
    useWorkspaceDataMock.mockReturnValue({
      currentWorkspaceId: 'workspace-b',
      workspaceGraph: makeGraph('#ff0000', 'workspace B label'),
    });
    rerender();

    expect(result.current.nodes[0]?.position).toEqual({ x: 0, y: 50 });
    expect(result.current.nodes[0]?.dragging).toBeUndefined();
    expect(result.current.nodes[0]?.selected).toBe(false);
    expect((result.current.nodes[0]?.data as unknown as TestNodeData).node.color).toBe('#ff0000');
    expect(result.current.edges[0]?.label).toBe('workspace B label');
  });

  it('reads the workspace at invocation time for cached graph commands', () => {
    const { result, rerender } = renderHook(() => useWorkspaceGraph());
    const cachedAddCommand = (result.current.nodes[0]?.data as unknown as TestNodeData)
      .onAddToSelection;

    useSelectionStore.setState({ currentWorkspaceId: 'workspace-b' });
    useWorkspaceDataMock.mockReturnValue({
      currentWorkspaceId: 'workspace-b',
      workspaceGraph: makeGraph('#ff0000', 'first label'),
    });
    rerender();

    act(() => {
      cachedAddCommand('node-1');
    });

    expect(requestNodeInputAddMock).toHaveBeenCalledWith(
      'workspace-b',
      expect.any(String),
      'node-1',
      undefined,
    );
  });

  it('adds a Data Block to the active tool on double-click, mirroring the + button', () => {
    const { result } = renderHook(() => useWorkspaceGraph());
    const event = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      clientX: 320,
      clientY: 180,
    };

    act(() => {
      result.current.handleNodeDoubleClick(
        event as unknown as Parameters<typeof result.current.handleNodeDoubleClick>[0],
        { id: 'node-1' } as unknown as Parameters<typeof result.current.handleNodeDoubleClick>[1],
      );
    });

    // Same add path as the node's "+" button (add-to-selection intent), not a
    // selection toggle — works whether or not the block is selected.
    expect(requestNodeInputAddMock).toHaveBeenCalledWith(
      'workspace-a',
      expect.any(String),
      'node-1',
      { x: 320, y: 180 },
    );
  });
});
