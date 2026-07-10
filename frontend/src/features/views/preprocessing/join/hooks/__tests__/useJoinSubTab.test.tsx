import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const joinNodesPreviewMock = vi.hoisted(() => vi.fn());

vi.mock('@/api', () => ({
  joinNodesPreview: joinNodesPreviewMock,
}));

vi.mock('@/features/auth/hooks/useAuth', () => ({
  useAuth: () => ({
    getAuthHeaders: () => ({ Authorization: 'Bearer test' }),
  }),
}));

import { useJoinSubTab } from '../useJoinSubTab';
import { projectWorkspaceNodeMetadata } from '@/features/workspace/common/workspaceNodeMetadata';

const pagination = {
  has_next: false,
  has_prev: false,
  page: 1,
  page_size: 10,
  total_pages: 1,
  total_rows: 1,
};

describe('useJoinSubTab preview adapter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    joinNodesPreviewMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses request-owned workspaces and aborts the exact SDK signal on workspace switch', async () => {
    let resolveFirst: ((value: unknown) => void) | null = null;
    const firstResponse = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    joinNodesPreviewMock
      .mockImplementationOnce(() => firstResponse)
      .mockResolvedValueOnce({
        data: { data: [{ id: 2 }], columns: ['id'], pagination },
      });

    const workspaceNodes = [
      projectWorkspaceNodeMetadata(
        { id: 'left', name: 'Left' },
        { id: 'left', name: 'Left', columns: ['id'], schema: { id: 'String' } },
      ),
      projectWorkspaceNodeMetadata(
        { id: 'right', name: 'Right' },
        { id: 'right', name: 'Right', columns: ['id'], schema: { id: 'String' } },
      ),
    ];
    const { rerender } = renderHook(
      ({ workspaceId }) =>
        useJoinSubTab({
          selectedNodeIds: ['left', 'right'],
          selectedNodeColumns: {},
          currentWorkspaceId: workspaceId,
          workspaceNodes,
          getColumnInfos: () => [{ name: 'id', dataType: 'string' }],
          joinNodes: vi.fn(),
          isLoading: { operations: false },
          onAlert: vi.fn(),
        }),
      { initialProps: { workspaceId: 'workspace-request-1' } },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    const firstOptions = joinNodesPreviewMock.mock.calls[0]?.[0] as {
      path: { workspace_id: string };
      signal: AbortSignal;
    };
    expect(firstOptions.path).toEqual({ workspace_id: 'workspace-request-1' });
    expect(firstOptions.signal.aborted).toBe(false);

    rerender({ workspaceId: 'workspace-request-2' });
    expect(firstOptions.signal.aborted).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    const secondOptions = joinNodesPreviewMock.mock.calls[1]?.[0] as {
      path: { workspace_id: string };
      signal: AbortSignal;
    };
    expect(secondOptions.path).toEqual({ workspace_id: 'workspace-request-2' });
    expect(secondOptions.signal).not.toBe(firstOptions.signal);
    expect(secondOptions.signal.aborted).toBe(false);

    await act(async () => {
      resolveFirst?.({ data: { data: [{ id: 1 }], columns: ['id'], pagination } });
      await firstResponse;
    });
  });
});
