import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { WorkspaceNodeInfo } from '@/api';

import { useTopicModelingParameters } from '../useTopicModelingParameters';

const nodeIds = (...counts: number[]) => counts.map((_, index) => `node-${String(index + 1)}`);

const nodeInfoById = (...counts: number[]): Record<string, WorkspaceNodeInfo> =>
  Object.fromEntries(
    counts.map((count, index) => {
      const id = `node-${String(index + 1)}`;
      return [
        id,
        {
          id,
          name: `Node ${String(index + 1)}`,
          shape: [count, 3] as WorkspaceNodeInfo['shape'],
        },
      ];
    }),
  );

describe('useTopicModelingParameters', () => {
  it('derives default corpus sampling from selected node sizes', async () => {
    const { result } = renderHook(() =>
      useTopicModelingParameters({
        panelNodeIds: nodeIds(8000, 80),
        nodeInfoById: nodeInfoById(8000, 80),
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.nodeDocCounts).toEqual([8000, 80]);
    expect(result.current.corpusSamples).toEqual([{ percent: '100' }, { percent: '100' }]);
    expect(result.current.effectiveDocCounts).toEqual([8000, 80]);
    expect(result.current.sampleFractionsForRequest).toEqual([null, null]);
    expect(result.current.hasAnySampling).toBe(false);
    expect(result.current.minClusterSize).toBe(10);
    expect(result.current.randomSeed).toBe(0);
  });

  it('tracks user-set parameters', async () => {
    const { result } = renderHook(() =>
      useTopicModelingParameters({
        panelNodeIds: nodeIds(8000),
        nodeInfoById: nodeInfoById(8000),
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.updateCorpusSample(0, { percent: '25' });
      result.current.setRandomSeedFromUser(99);
    });

    expect(result.current.corpusSamplesUserSet).toBe(true);
    expect(result.current.randomSeedUserSet).toBe(true);
    expect(result.current.sampleFractionsForRequest).toEqual([0.25]);
  });

  it('hydrates saved request parameters and sampling fractions', () => {
    const { result } = renderHook(() =>
      useTopicModelingParameters({
        panelNodeIds: nodeIds(10000, 5000),
        nodeInfoById: nodeInfoById(10000, 5000),
      }),
    );

    act(() => {
      result.current.hydrateParameters({
        node_ids: ['node-1', 'node-2'],
        node_columns: { 'node-1': 'text', 'node-2': 'text' },
        min_cluster_size: 25,
        random_seed: 7,
        sample_fractions: [0.2, null],
      });
    });

    expect(result.current.minClusterSize).toBe(25);
    expect(result.current.randomSeed).toBe(7);
    expect(result.current.randomSeedUserSet).toBe(true);
    expect(result.current.corpusSamples).toEqual([{ percent: '20' }, { percent: '100' }]);
    expect(result.current.corpusSamplesUserSet).toBe(true);
  });

  it('restores hydrated sampling fractions after selected node counts resolve', async () => {
    const { result, rerender } = renderHook(
      ({ panelNodeIdsKey }: { panelNodeIdsKey: string }) =>
        useTopicModelingParameters({
          panelNodeIds: panelNodeIdsKey ? panelNodeIdsKey.split('|') : [],
          nodeInfoById: panelNodeIdsKey === 'node-1' ? nodeInfoById(10000) : {},
        }),
      {
        initialProps: { panelNodeIdsKey: '' },
      },
    );

    act(() => {
      result.current.hydrateParameters({
        node_ids: ['node-1'],
        node_columns: { 'node-1': 'text' },
        random_seed: 7,
        sample_fractions: [0.2],
      });
    });

    rerender({ panelNodeIdsKey: 'node-1' });

    await waitFor(() => {
      expect(result.current.corpusSamples).toEqual([{ percent: '20' }]);
      expect(result.current.sampleFractionsForRequest).toEqual([0.2]);
    });
  });
});
