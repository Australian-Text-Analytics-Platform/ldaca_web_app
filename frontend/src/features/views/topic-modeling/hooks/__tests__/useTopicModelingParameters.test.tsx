import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { WorkspaceNodeInfo } from '@/api';

import {
  projectWorkspaceNodeMetadata,
  type WorkspaceNodeMetadata,
} from '@/features/workspace/common/workspaceNodeMetadata';
import {
  DEFAULT_TOPIC_SIZE_VALUE,
  useTopicModelingParameters,
} from '../useTopicModelingParameters';

const nodes = (...counts: number[]): WorkspaceNodeMetadata[] =>
  counts.map((_count, index) =>
    projectWorkspaceNodeMetadata({
      id: `node-${String(index + 1)}`,
      name: `Node ${String(index + 1)}`,
    }),
  );

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
        panelSelectedNodes: nodes(8000, 80),
        panelNodeIds: nodeIds(8000, 80),
        panelNodeIdsKey: 'node-1|node-2',
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
    expect(result.current.randomSeed).toBe(0);
  });

  it('tracks user-set parameters and preserves tuned sampling across clear', async () => {
    const { result } = renderHook(() =>
      useTopicModelingParameters({
        panelSelectedNodes: nodes(8000),
        panelNodeIds: nodeIds(8000),
        panelNodeIdsKey: 'node-1',
        nodeInfoById: nodeInfoById(8000),
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.updateCorpusSample(0, { percent: '25' });
      result.current.setTopicSizeValueFromUser(6);
      result.current.setRandomSeedFromUser(99);
    });

    expect(result.current.corpusSamplesUserSet).toBe(true);
    expect(result.current.topicSizeUserSet).toBe(true);
    expect(result.current.randomSeedUserSet).toBe(true);
    expect(result.current.sampleFractionsForRequest).toEqual([0.25]);

    act(() => {
      result.current.resetAfterClear();
    });

    expect(result.current.corpusSamples).toEqual([{ percent: '25' }]);
    expect(result.current.topicSizeValue).toBe(DEFAULT_TOPIC_SIZE_VALUE);
    expect(result.current.topicSizeUserSet).toBe(false);
    expect(result.current.randomSeed).toBe(99);
    expect(result.current.randomSeedUserSet).toBe(false);
  });

  it('hydrates saved request parameters and sampling fractions', () => {
    const { result } = renderHook(() =>
      useTopicModelingParameters({
        panelSelectedNodes: nodes(10000, 5000),
        panelNodeIds: nodeIds(10000, 5000),
        panelNodeIdsKey: 'node-1|node-2',
        nodeInfoById: nodeInfoById(10000, 5000),
      }),
    );

    act(() => {
      result.current.hydrateParameters({
        random_seed: 7,
        min_topic_size: 12,
        sample_fractions: [0.2, null],
      });
    });

    expect(result.current.randomSeed).toBe(7);
    expect(result.current.randomSeedUserSet).toBe(true);
    expect(result.current.topicSizeValue).toBe(12);
    expect(result.current.topicSizeUserSet).toBe(true);
    expect(result.current.corpusSamples).toEqual([{ percent: '20' }, { percent: '100' }]);
    expect(result.current.corpusSamplesUserSet).toBe(true);
  });

  it('restores hydrated sampling fractions after selected node counts resolve', async () => {
    const { result, rerender } = renderHook(
      ({
        panelSelectedNodes,
        panelNodeIdsKey,
      }: {
        panelSelectedNodes: WorkspaceNodeMetadata[];
        panelNodeIdsKey: string;
      }) =>
        useTopicModelingParameters({
          panelSelectedNodes,
          panelNodeIds: panelNodeIdsKey ? panelNodeIdsKey.split('|') : [],
          panelNodeIdsKey,
          nodeInfoById: panelNodeIdsKey === 'node-1' ? nodeInfoById(10000) : {},
        }),
      {
        initialProps: {
          panelSelectedNodes: [] as WorkspaceNodeMetadata[],
          panelNodeIdsKey: '',
        },
      },
    );

    act(() => {
      result.current.hydrateParameters({
        random_seed: 7,
        min_topic_size: 12,
        sample_fractions: [0.2],
      });
    });

    rerender({
      panelSelectedNodes: nodes(10000),
      panelNodeIdsKey: 'node-1',
    });

    await waitFor(() => {
      expect(result.current.corpusSamples).toEqual([{ percent: '20' }]);
      expect(result.current.sampleFractionsForRequest).toEqual([0.2]);
    });
  });
});
