import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useNodeColorControls } from '../useNodeColorControls';
import { GREY, RANDOMIZABLE_FG } from '../../vizPalette';
import { projectWorkspaceNodeMetadata } from '@/features/workspace/common/workspaceNodeMetadata';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useNodeColorControls', () => {
  it('keeps persisted colours and pre-fills a temporary non-grey colour for unset blocks', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
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

    await waitFor(() => {
      expect(result.current.nodeColors['node-2']).not.toBe(GREY);
    });
    expect(result.current.nodeColors['node-1']).toBe('#111111');
    expect(RANDOMIZABLE_FG).toContain(result.current.nodeColors['node-2']);
    // The preview is NOT persisted — graph/sidebar stay untouched until a run.
    expect(persistNodeColor).not.toHaveBeenCalled();
  });

  it('pre-fills distinct temporary colours for sibling unset blocks', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const persistNodeColor = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useNodeColorControls({
        nodeIds: ['a', 'b', 'c'],
        nodes: [
          projectWorkspaceNodeMetadata({ id: 'a', name: 'A' }),
          projectWorkspaceNodeMetadata({ id: 'b', name: 'B' }),
          projectWorkspaceNodeMetadata({ id: 'c', name: 'C' }),
        ],
        persistNodeColor,
      }),
    );

    await waitFor(() => {
      expect(result.current.nodeColors.c).not.toBe(GREY);
    });
    const previews = ['a', 'b', 'c'].map((id) => result.current.nodeColors[id]);
    expect(new Set(previews).size).toBe(3); // distinct
    previews.forEach((color) => {
      expect(color).not.toBe(GREY);
      expect(RANDOMIZABLE_FG).toContain(color);
    });
    expect(persistNodeColor).not.toHaveBeenCalled();
  });

  it('commits the previewed colour to Node.color only on ensureNodeColors', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const persistNodeColor = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useNodeColorControls({
        nodeIds: ['node-1'],
        nodes: [projectWorkspaceNodeMetadata({ id: 'node-1', name: 'Corpus' })],
        persistNodeColor,
      }),
    );

    await waitFor(() => {
      expect(result.current.nodeColors['node-1']).not.toBe(GREY);
    });
    const preview = result.current.nodeColors['node-1'];
    expect(persistNodeColor).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.ensureNodeColors();
    });

    expect(persistNodeColor).toHaveBeenCalledTimes(1);
    expect(persistNodeColor).toHaveBeenCalledWith('node-1', preview);
  });

  it('reverts (discards) the preview when a block is deselected without running', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const persistNodeColor = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      (props: { ids: string[] }) =>
        useNodeColorControls({
          nodeIds: props.ids,
          nodes: [
            projectWorkspaceNodeMetadata({ id: 'node-1', name: 'One' }),
            projectWorkspaceNodeMetadata({ id: 'node-2', name: 'Two' }),
          ],
          persistNodeColor,
        }),
      { initialProps: { ids: ['node-1', 'node-2'] } },
    );

    await waitFor(() => {
      expect(result.current.nodeColors['node-2']).not.toBe(GREY);
    });

    // Deselect node-2 before any run.
    rerender({ ids: ['node-1'] });

    await waitFor(() => {
      expect(result.current.nodeColors['node-2']).toBeUndefined();
    });
    // Nothing was ever persisted, so the block reverts to its (grey) default.
    expect(persistNodeColor).not.toHaveBeenCalled();
  });

  it('persists an explicit picker colour immediately and does not repeat it on run', async () => {
    const persistNodeColor = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useNodeColorControls({
        nodeIds: ['node-1'],
        nodes: [projectWorkspaceNodeMetadata({ id: 'node-1', name: 'Corpus' })],
        persistNodeColor,
      }),
    );

    act(() => {
      result.current.setNodeColor('node-1', '#ABCDEF');
    });

    expect(result.current.nodeColors['node-1']).toBe('#abcdef');
    await waitFor(() => {
      expect(persistNodeColor).toHaveBeenCalledTimes(1);
    });
    expect(persistNodeColor).toHaveBeenCalledWith('node-1', '#abcdef');

    // Running later only commits automatically assigned preview colours.
    await act(async () => {
      await result.current.ensureNodeColors();
    });
    expect(persistNodeColor).toHaveBeenCalledTimes(1);
  });

  it('does not make analysis preparation wait for an in-flight explicit colour write', async () => {
    let finishPersistence: (() => void) | undefined;
    const persistNodeColor = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishPersistence = resolve;
        }),
    );
    const { result } = renderHook(() =>
      useNodeColorControls({
        nodeIds: ['node-1'],
        nodes: [projectWorkspaceNodeMetadata({ id: 'node-1', name: 'Corpus' })],
        persistNodeColor,
      }),
    );

    act(() => {
      result.current.setNodeColor('node-1', '#ABCDEF');
    });
    await waitFor(() => {
      expect(persistNodeColor).toHaveBeenCalledWith('node-1', '#abcdef');
    });

    await act(async () => {
      await result.current.ensureNodeColors();
    });
    expect(persistNodeColor).toHaveBeenCalledTimes(1);

    finishPersistence?.();
  });

  it('rolls back an explicit picker colour when immediate persistence fails', async () => {
    const persistNodeColor = vi.fn().mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() =>
      useNodeColorControls({
        nodeIds: ['node-1'],
        nodes: [
          projectWorkspaceNodeMetadata({
            id: 'node-1',
            name: 'Corpus',
            color: '#111111',
          }),
        ],
        persistNodeColor,
      }),
    );

    act(() => {
      result.current.setNodeColor('node-1', '#ABCDEF');
    });

    expect(result.current.nodeColors['node-1']).toBe('#abcdef');
    await waitFor(() => {
      expect(result.current.nodeColors['node-1']).toBe('#111111');
    });
  });
});
