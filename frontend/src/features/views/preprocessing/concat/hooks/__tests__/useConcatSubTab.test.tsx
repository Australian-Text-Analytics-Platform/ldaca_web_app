import { act, renderHook } from '@testing-library/react';
import { Field, Utf8 } from 'apache-arrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useConcatSubTab } from '../useConcatSubTab';
import { projectWorkspaceNodeMetadata } from '@/features/workspace/common/workspaceNodeMetadata';

const pagination = {
  has_next: false,
  page: 1,
  page_size: 10,
};

describe('useConcatSubTab preview adapter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('forwards request-owned workspaces and aborts the first custom-adapter signal on switch', async () => {
    let resolveFirst: ((value: unknown) => void) | null = null;
    const firstResponse = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    const concatPreview = vi
      .fn()
      .mockImplementationOnce(() => firstResponse)
      .mockResolvedValueOnce({ data: [{ id: 2 }], columns: ['id'], pagination });
    const workspaceNodes = [
      projectWorkspaceNodeMetadata({ id: 'node-1', name: 'One' }),
      projectWorkspaceNodeMetadata({ id: 'node-2', name: 'Two' }),
    ];

    const { rerender } = renderHook(
      ({ workspaceId }) =>
        useConcatSubTab({
          selectedNodeIds: ['node-1', 'node-2'],
          currentWorkspaceId: workspaceId,
          workspaceNodes,
          getColumnInfos: () => [
            { name: 'id', dataType: 'string', field: new Field('id', new Utf8()) },
          ],
          concatPreview,
          concatNodes: vi.fn(),
          isLoading: { operations: false },
          onAlert: vi.fn(),
        }),
      { initialProps: { workspaceId: 'workspace-request-1' } },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    const firstRequest = concatPreview.mock.calls[0]?.[0] as {
      workspaceId: string;
      signal: AbortSignal;
    };
    expect(firstRequest.workspaceId).toBe('workspace-request-1');
    expect(firstRequest.signal.aborted).toBe(false);

    rerender({ workspaceId: 'workspace-request-2' });
    expect(firstRequest.signal.aborted).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    const secondRequest = concatPreview.mock.calls[1]?.[0] as {
      workspaceId: string;
      signal: AbortSignal;
    };
    expect(secondRequest.workspaceId).toBe('workspace-request-2');
    expect(secondRequest.signal).not.toBe(firstRequest.signal);
    expect(secondRequest.signal.aborted).toBe(false);

    await act(async () => {
      resolveFirst?.({ data: [{ id: 1 }], columns: ['id'], pagination });
      await firstResponse;
    });
  });
});
