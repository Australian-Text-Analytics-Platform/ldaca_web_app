import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useNodeColorControls } from '../useNodeColorControls';
import { projectWorkspaceNodeMetadata } from '@/features/workspace/common/workspaceNodeMetadata';

describe('useNodeColorControls', () => {
  it('derives colours from persisted node metadata and posts defaults for missing colours', async () => {
    const persistNodeColor = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useNodeColorControls({
        nodeIds: ['node-1', 'node-2'],
        nodes: [
          projectWorkspaceNodeMetadata({ id: 'node-1', name: 'Saved', color: '#111111' }),
          projectWorkspaceNodeMetadata({ id: 'node-2', name: 'Missing' }),
        ],
        persistNodeColor,
      }),
    );

    expect(result.current.nodeColors).toEqual({
      'node-1': '#111111',
      'node-2': '#dc2626',
    });

    await act(async () => {
      await result.current.ensureNodeColors();
    });

    expect(persistNodeColor).toHaveBeenCalledTimes(1);
    expect(persistNodeColor).toHaveBeenCalledWith('node-2', '#dc2626');
  });

  it('posts picked colours immediately without waiting for an analysis request', async () => {
    const persistNodeColor = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useNodeColorControls({
        nodeIds: ['node-1'],
        nodes: [projectWorkspaceNodeMetadata({ id: 'node-1', name: 'Corpus' })],
        persistNodeColor,
      }),
    );

    await act(async () => {
      await result.current.setNodeColor('node-1', '#ABCDEF');
    });

    expect(result.current.nodeColors['node-1']).toBe('#abcdef');
    expect(persistNodeColor).toHaveBeenCalledWith('node-1', '#abcdef');
  });
});
