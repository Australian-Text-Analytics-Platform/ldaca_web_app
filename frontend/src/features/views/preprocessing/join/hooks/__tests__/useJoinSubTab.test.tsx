import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Field, Utf8 } from 'apache-arrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const previewNodeCreationTableMock = vi.hoisted(() => vi.fn());

vi.mock('@/api', () => ({
  previewNodeCreationTable: previewNodeCreationTableMock,
}));

import { useJoinSubTab } from '../useJoinSubTab';
import { projectWorkspaceNodeMetadata } from '@/features/workspace/common/workspaceNodeMetadata';

const createWrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
};

describe('useJoinSubTab preview adapter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    previewNodeCreationTableMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses request-owned workspaces and aborts the exact SDK signal on workspace switch', async () => {
    let resolveFirst: ((value: unknown) => void) | null = null;
    const firstResponse = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    previewNodeCreationTableMock
      .mockImplementationOnce(() => firstResponse)
      .mockResolvedValueOnce({
        rows: [{ id: 2 }],
        columns: ['id'],
        hasNext: false,
      });

    const workspaceNodes = [
      projectWorkspaceNodeMetadata({ id: 'left', name: 'Left' }),
      projectWorkspaceNodeMetadata({ id: 'right', name: 'Right' }),
    ];
    const { rerender } = renderHook(
      ({ workspaceId }) =>
        useJoinSubTab({
          selectedNodeIds: ['left', 'right'],
          selectedNodeColumns: {},
          setSelectedNodeColumns: vi.fn(),
          currentWorkspaceId: workspaceId,
          workspaceNodes,
          getColumnInfos: () => [
            { name: 'id', typeName: 'Utf8', field: new Field('id', new Utf8()) },
          ],
          joinNodes: vi.fn(),
          isLoading: { operations: false },
          onAlert: vi.fn(),
        }),
      { initialProps: { workspaceId: 'workspace-request-1' }, wrapper: createWrapper() },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    const firstOptions = previewNodeCreationTableMock.mock.calls[0]?.[0] as {
      path: { workspace_id: string };
      body: Record<string, unknown>;
      signal: AbortSignal;
    };
    expect(firstOptions.path).toEqual({ workspace_id: 'workspace-request-1' });
    expect(firstOptions.body).toMatchObject({
      kind: 'join',
      left_node_id: 'left',
      right_node_id: 'right',
      left_on: 'id',
      right_on: 'id',
      how: 'left',
    });
    expect(firstOptions.signal.aborted).toBe(false);

    rerender({ workspaceId: 'workspace-request-2' });
    expect(firstOptions.signal.aborted).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    const secondOptions = previewNodeCreationTableMock.mock.calls[1]?.[0] as {
      path: { workspace_id: string };
      signal: AbortSignal;
    };
    expect(secondOptions.path).toEqual({ workspace_id: 'workspace-request-2' });
    expect(secondOptions.signal).not.toBe(firstOptions.signal);
    expect(secondOptions.signal.aborted).toBe(false);

    await act(async () => {
      resolveFirst?.({
        rows: [{ id: 1 }],
        columns: ['id'],
        hasNext: false,
      });
      await firstResponse;
    });
  });

  it('selects the first shared column when both nodes still use their defaults', () => {
    const setSelectedNodeColumns = vi.fn();
    const workspaceNodes = [
      projectWorkspaceNodeMetadata({ id: 'left', name: 'Tweets' }),
      projectWorkspaceNodeMetadata({ id: 'right', name: 'Candidates' }),
    ];

    renderHook(
      () =>
        useJoinSubTab({
          selectedNodeIds: ['left', 'right'],
          selectedNodeColumns: {
            left: 'tweet_id',
            right: 'party',
          },
          setSelectedNodeColumns,
          currentWorkspaceId: null,
          workspaceNodes,
          getColumnInfos: (node) =>
            node.id === 'left'
              ? [
                  {
                    name: 'tweet_id',
                    typeName: 'Utf8',
                    field: new Field('tweet_id', new Utf8()),
                  },
                  {
                    name: 'username',
                    typeName: 'Utf8',
                    field: new Field('username', new Utf8()),
                  },
                ]
              : [
                  { name: 'party', typeName: 'Utf8', field: new Field('party', new Utf8()) },
                  {
                    name: 'username',
                    typeName: 'Utf8',
                    field: new Field('username', new Utf8()),
                  },
                ],
          joinNodes: vi.fn(),
          isLoading: { operations: false },
          onAlert: vi.fn(),
        }),
      { wrapper: createWrapper() },
    );

    expect(setSelectedNodeColumns).toHaveBeenCalledOnce();
    expect(setSelectedNodeColumns).toHaveBeenCalledWith({
      left: 'username',
      right: 'username',
    });
  });
});
