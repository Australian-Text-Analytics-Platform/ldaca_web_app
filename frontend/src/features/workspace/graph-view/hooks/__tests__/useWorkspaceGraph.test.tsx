import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSelectionStore } from '@/stores/selectionStore';
import { useFreshNodesStore } from '@/stores/freshNodesStore';

const useWorkspaceDataMock = vi.hoisted(() => vi.fn());
const useWorkspaceSelectionMock = vi.hoisted(() => vi.fn());
const useWorkspaceStatusMock = vi.hoisted(() => vi.fn());
const useWorkspaceActionsMock = vi.hoisted(() => vi.fn());
const requestNodeInputAddMock = vi.hoisted(() => vi.fn());

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
    new Map(nodes.map((node, index) => [node.id, { x: index * 100, y: 50 }])),
}));

import { useWorkspaceGraph } from '../useWorkspaceGraph';

const makeGraph = (color: string, edgeLabel: string) => ({
  nodes: [
    {
      id: 'node-1',
      name: 'Node one',
      color,
      document: 'text',
      can_undo: false,
      can_redo: true,
    },
  ],
  edges: [{ source: 'node-1', target: 'node-1', label: edgeLabel }],
});

interface TestNodeData {
  node: { color: string | null };
  onAddToSelection: (nodeId: string) => void;
}

describe('useWorkspaceGraph', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    requestNodeInputAddMock.mockReset();
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
      undoNode: vi.fn(),
      redoNode: vi.fn(),
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
      workspaceGraph: makeGraph('#0000ff', 'second label'),
    });
    rerender();

    expect(result.current.nodes[0]?.position).toEqual(draggedPosition);
    expect(result.current.nodes[0]?.dragging).toBe(true);
    expect((result.current.nodes[0]?.data as unknown as TestNodeData).node.color).toBe('#0000ff');
    expect(result.current.edges[0]?.label).toBe('second label');
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
    );
  });
});
