import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useAnalysisHydration } from '../useAnalysisHydration';

describe('useAnalysisHydration', () => {
  it('applies the saved request before applying a result that depends on restored context', async () => {
    const applied: string[] = [];
    const { result } = renderHook(() =>
      useAnalysisHydration({
        workspaceId: 'workspace-1',
        resolveTaskId: () => 'task-1',
        fetchRequest: () => Promise.resolve({ node_id: 'node-1' }),
        fetchResult: () => Promise.resolve({ rows: [1] }),
        applyRequest: async () => {
          await Promise.resolve();
          applied.push('request');
        },
        applyResult: () => {
          applied.push('result');
        },
      }),
    );

    await act(async () => {
      await result.current.hydrateFromServer();
    });

    expect(applied).toEqual(['request', 'result']);
  });

  it('restores the owned request and result and resets visible state when the workspace changes', async () => {
    const resolveTaskId = vi.fn(() => Promise.resolve('task-1'));
    const fetchRequest = vi.fn(() => Promise.resolve({ query: 'word' }));
    const fetchResult = vi.fn(() => Promise.resolve({ rows: [1] }));
    const applyRequest = vi.fn(() => Promise.resolve());
    const applyResult = vi.fn(() => Promise.resolve());

    const { result, rerender } = renderHook(
      ({ workspaceId }: { workspaceId: string }) =>
        useAnalysisHydration({
          workspaceId,
          resolveTaskId,
          fetchRequest,
          fetchResult,
          applyRequest,
          applyResult,
        }),
      { initialProps: { workspaceId: 'workspace-1' } },
    );

    await act(async () => {
      await result.current.hydrateFromServer();
    });

    expect(fetchRequest).toHaveBeenCalledWith('task-1');
    expect(fetchResult).toHaveBeenCalledWith('task-1');
    expect(applyRequest).toHaveBeenCalledWith({ query: 'word' });
    expect(applyResult).toHaveBeenCalledWith({ rows: [1] });
    expect(result.current.hydrationState).toMatchObject({
      status: 'idle',
      lastHydratedAt: expect.any(Number),
    });

    rerender({ workspaceId: 'workspace-2' });

    expect(result.current.hydrationState).toEqual({ status: 'idle' });
  });
});
