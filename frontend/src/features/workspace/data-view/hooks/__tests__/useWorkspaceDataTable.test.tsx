import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryWorkspaceSqlTableMock = vi.hoisted(() => vi.fn());
const useWorkspaceDataMock = vi.hoisted(() => vi.fn());
const useWorkspaceSelectionMock = vi.hoisted(() => vi.fn());
const useWorkspaceStatusMock = vi.hoisted(() => vi.fn());
const useWorkspaceActionsMock = vi.hoisted(() => vi.fn());

vi.mock('@/api', () => ({
  queryWorkspaceSqlTable: queryWorkspaceSqlTableMock,
  sqlOrder: (column: string, descending: boolean) =>
    `"${column}" ${descending ? 'DESC' : 'ASC'} NULLS FIRST`,
  sqlTable: (value: string) => `"${value}"`,
}));
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

import { useWorkspaceDataTable } from '../useWorkspaceDataTable';

const activateNode = vi.fn();
const reorderSelectedNodes = vi.fn();
const removeNode = vi.fn();

const makeNodeDataResponse = () => ({
  rows: [{ text: 'row' }],
  page: 1,
  page_size: 20,
  columns: ['text'],
  dtypes: { text: 'String' },
  hasNext: false,
});

const createWrapper = (queryClient: QueryClient) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };

describe('useWorkspaceDataTable', () => {
  beforeEach(() => {
    activateNode.mockReset();
    reorderSelectedNodes.mockReset();
    removeNode.mockReset();
    queryWorkspaceSqlTableMock.mockReset();
    queryWorkspaceSqlTableMock.mockResolvedValue(makeNodeDataResponse());
    useWorkspaceDataMock.mockReturnValue({
      currentWorkspaceId: 'workspace-1',
      nodeData: makeNodeDataResponse(),
    });
    const selectedNodes = [
      { id: 'node-a', name: 'A' },
      { id: 'node-b', name: 'B' },
      { id: 'node-c', name: 'C' },
    ];
    useWorkspaceSelectionMock.mockReturnValue({
      activeNodeId: 'node-b',
      selectedNode: selectedNodes[1],
      selectedNodes,
      selectedNodeIds: selectedNodes.map((node) => node.id),
    });
    useWorkspaceStatusMock.mockReturnValue({ isLoading: { nodeData: false } });
    useWorkspaceActionsMock.mockReturnValue({
      activateNode,
      reorderSelectedNodes,
      removeNode,
      castColumn: vi.fn(),
      renameColumn: vi.fn(),
      deleteColumn: vi.fn(),
      refreshNodeSchema: vi.fn(),
      deleteNode: vi.fn(),
      renameNode: vi.fn(),
      undoNode: vi.fn(),
      redoNode: vi.fn(),
      selectNodes: vi.fn(),
      toggleNodeSelection: vi.fn(),
    });
  });

  it('delegates tab activation, close, and reorder to semantic selection actions', () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result } = renderHook(() => useWorkspaceDataTable(), {
      wrapper: createWrapper(queryClient),
    });

    act(() => {
      result.current.tabs.onTabChange('node-c');
      result.current.tabs.onTabClose('node-a');
      result.current.tabs.onTabReorder(['node-c', 'node-b', 'node-a']);
    });

    expect(activateNode).toHaveBeenCalledWith('node-c');
    expect(removeNode).toHaveBeenCalledWith('node-a');
    expect(reorderSelectedNodes).toHaveBeenCalledWith(['node-c', 'node-b', 'node-a']);
  });

  it('uses one complete request object for the query key and SDK request', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    renderHook(() => useWorkspaceDataTable(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(queryWorkspaceSqlTableMock).toHaveBeenCalledTimes(1);
    });

    const request = { page: 1, page_size: 20, sort_by: null, descending: false };
    expect(queryWorkspaceSqlTableMock).toHaveBeenLastCalledWith({
      path: { workspace_id: 'workspace-1' },
      body: {
        mode: 'query',
        node_ids: ['node-b'],
        sql: 'SELECT * FROM "node-b"',
        page: 1,
        page_size: 20,
      },
    });
    expect(
      queryClient
        .getQueryCache()
        .getAll()
        .some(
          (query) =>
            JSON.stringify(query.queryKey) ===
            JSON.stringify(['workspaces', 'workspace-1', 'nodes', 'node-b', 'data', request]),
        ),
    ).toBe(true);
  });
});
