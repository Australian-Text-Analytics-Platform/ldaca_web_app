import { act, renderHook } from '@testing-library/react';
import { Field, Utf8 } from 'apache-arrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const previewNodeCreationTableMock = vi.hoisted(() => vi.fn());

vi.mock('@/api', () => ({
  previewNodeCreationTable: previewNodeCreationTableMock,
}));

import { useJoinSubTab } from '../useJoinSubTab';
import { projectWorkspaceNodeMetadata } from '@/features/workspace/common/workspaceNodeMetadata';

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
          currentWorkspaceId: workspaceId,
          workspaceNodes,
          getColumnInfos: () => [
            { name: 'id', dataType: 'string', field: new Field('id', new Utf8()) },
          ],
          joinNodes: vi.fn(),
          isLoading: { operations: false },
          onAlert: vi.fn(),
        }),
      { initialProps: { workspaceId: 'workspace-request-1' } },
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
});
