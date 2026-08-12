import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Field, Utf8 } from 'apache-arrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from '@/lib/queryKeys';

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

const makeArrowPage = (
  columns: { name: string; field: Field }[] = [
    { name: 'text', field: new Field('text', new Utf8()) },
  ],
  rows: Record<string, unknown>[] = [{ text: 'row' }],
  hasNext = false,
) => ({
  table: {},
  rows,
  columns: columns.map((column) => column.name),
  schema: columns,
  hasNext,
  etag: 'etag-1',
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
    queryWorkspaceSqlTableMock.mockResolvedValue(makeArrowPage());
    useWorkspaceDataMock.mockReturnValue({
      currentWorkspaceId: 'workspace-1',
    });
    const selectedNodes = [
      { id: 'node-a', name: 'A', shape: [100, 1] },
      { id: 'node-b', name: 'B', shape: [1_000, 1] },
      { id: 'node-c', name: 'C', shape: [50, 1] },
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
            JSON.stringify([
              'workspaces',
              'workspace-1',
              'sql',
              {
                nodeIds: ['node-b'],
                sql: 'SELECT * FROM "node-b"',
                page: 1,
                pageSize: 20,
              },
            ]),
        ),
    ).toBe(true);
  });

  it('projects a raw Workspace SQL page already cached by Annotation', () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(
      queryKeys.workspaceSql('workspace-1', ['node-b'], 'SELECT * FROM "node-b"', 1, 20),
      makeArrowPage(),
    );

    const { result } = renderHook(() => useWorkspaceDataTable(), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.table.data).toEqual([{ text: 'row' }]);
    expect(result.current.table.columns).toEqual(['text']);
    expect(result.current.table.columnFields.text?.type.toString()).toBe('Utf8');
  });

  it('preserves the schema of an empty class-description Data Block', () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(
      queryKeys.workspaceSql('workspace-1', ['node-b'], 'SELECT * FROM "node-b"', 1, 20),
      makeArrowPage(
        [
          { name: 'class', field: new Field('class', new Utf8()) },
          { name: 'description', field: new Field('description', new Utf8()) },
        ],
        [],
      ),
    );

    const { result } = renderHook(() => useWorkspaceDataTable(), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.header.isEmptyTable).toBe(true);
    expect(result.current.table.data).toEqual([]);
    expect(result.current.table.columns).toEqual(['class', 'description']);
    expect(result.current.table.columnFields.class?.type.toString()).toBe('Utf8');
    expect(result.current.table.columnFields.description?.type.toString()).toBe('Utf8');
  });

  it('uses the selected Data Block shape as the exact Data View row count', () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const { result } = renderHook(() => useWorkspaceDataTable(), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.table.rowCount).toBe(1_000);
    expect(result.current.table.hasNext).toBeUndefined();
  });

  it('falls back to Arrow lookahead when the Data Block row count is unknown', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const selectedNode = { id: 'node-b', name: 'B', shape: [null, 1] };
    useWorkspaceSelectionMock.mockReturnValue({
      activeNodeId: selectedNode.id,
      selectedNode,
      selectedNodes: [selectedNode],
      selectedNodeIds: [selectedNode.id],
    });
    queryWorkspaceSqlTableMock.mockResolvedValue(makeArrowPage(undefined, undefined, true));

    const { result } = renderHook(() => useWorkspaceDataTable(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.table.hasNext).toBe(true);
    });
    expect(result.current.table.rowCount).toBeUndefined();
  });
});
