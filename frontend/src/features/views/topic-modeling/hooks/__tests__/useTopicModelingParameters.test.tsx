import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { WorkspaceNodeLike } from '@/features/views/common/nodeSelectionTypes';
import {
  DEFAULT_TOPIC_SIZE_VALUE,
  useTopicModelingParameters,
} from '../useTopicModelingParameters';

const nodes = (...counts: number[]): WorkspaceNodeLike[] =>
  counts.map((count, index) => ({
    id: `node-${String(index + 1)}`,
    name: `Node ${String(index + 1)}`,
    shape: [count, 3],
  }));

describe('useTopicModelingParameters', () => {
  it('derives default corpus sampling from selected node sizes', async () => {
    const { result } = renderHook(() =>
      useTopicModelingParameters({
        panelSelectedNodes: nodes(8000, 80),
        panelNodeIdsKey: 'node-1|node-2',
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
  });

  it('tracks user-set parameters and preserves tuned sampling across clear', async () => {
    const { result } = renderHook(() =>
      useTopicModelingParameters({
        panelSelectedNodes: nodes(8000),
        panelNodeIdsKey: 'node-1',
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.updateCorpusSample(0, { percent: '25' });
      result.current.setTopicSizeValueFromUser(6);
      result.current.setRandomSeedFromUser(99);
      result.current.setRepresentativeWordsCountFromUser(25);
    });

    expect(result.current.corpusSamplesUserSet).toBe(true);
    expect(result.current.topicSizeUserSet).toBe(true);
    expect(result.current.randomSeedUserSet).toBe(true);
    expect(result.current.representativeWordsCountUserSet).toBe(true);
    expect(result.current.sampleFractionsForRequest).toEqual([0.25]);

    act(() => {
      result.current.resetAfterClear();
    });

    expect(result.current.corpusSamples).toEqual([{ percent: '25' }]);
    expect(result.current.topicSizeValue).toBe(DEFAULT_TOPIC_SIZE_VALUE);
    expect(result.current.topicSizeUserSet).toBe(false);
    expect(result.current.randomSeed).toBe(99);
    expect(result.current.randomSeedUserSet).toBe(false);
    expect(result.current.representativeWordsCount).toBe(25);
    expect(result.current.representativeWordsCountUserSet).toBe(false);
  });

  it('hydrates saved request parameters and sampling fractions', () => {
    const { result } = renderHook(() =>
      useTopicModelingParameters({
        panelSelectedNodes: nodes(10000, 5000),
        panelNodeIdsKey: 'node-1|node-2',
      }),
    );

    act(() => {
      result.current.hydrateParameters({
        random_seed: 7,
        representative_words_count: 30,
        min_topic_size: 12,
        sample_fractions: [0.2, null],
      });
    });

    expect(result.current.randomSeed).toBe(7);
    expect(result.current.randomSeedUserSet).toBe(true);
    expect(result.current.representativeWordsCount).toBe(30);
    expect(result.current.representativeWordsCountUserSet).toBe(true);
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
        panelSelectedNodes: WorkspaceNodeLike[];
        panelNodeIdsKey: string;
      }) =>
        useTopicModelingParameters({
          panelSelectedNodes,
          panelNodeIdsKey,
        }),
      {
        initialProps: {
          panelSelectedNodes: [] as WorkspaceNodeLike[],
          panelNodeIdsKey: '',
        },
      },
    );

    act(() => {
      result.current.hydrateParameters({
        random_seed: 7,
        representative_words_count: 30,
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
