import { describe, expect, it } from 'vitest';

import {
  createTopicModelingParameterState,
  topicModelingParameterReducer,
} from '../topicModelingParameterState';

describe('topicModelingParameterReducer', () => {
  it('marks corpus sampling as user-set when a row changes', () => {
    const updated = topicModelingParameterReducer(createTopicModelingParameterState(), {
      type: 'updateCorpusSample',
      nodeId: 'node-1',
      update: { percent: '25' },
    });

    expect(updated.corpusSamplesByNodeId).toEqual({ 'node-1': { percent: '25' } });
    expect(updated.userSetSampleNodeIds).toEqual({ 'node-1': true });
  });

  it('hydrates saved request parameters and sample fractions together', () => {
    const state = topicModelingParameterReducer(createTopicModelingParameterState(), {
      type: 'hydrateRequest',
      request: {
        node_ids: ['node-1', 'node-2'],
        node_columns: { 'node-1': 'text', 'node-2': 'text' },
        min_cluster_size: 25,
        random_seed: 7,
        segmentation_method: 'line',
        max_segment_tokens: 64,
        sample_fractions: [0.2, null],
      },
    });

    expect(state).toMatchObject({
      minClusterSize: 25,
      randomSeed: 7,
      randomSeedUserSet: true,
      segmentationMethod: 'line',
      maxSegmentTokens: 64,
      corpusSamplesByNodeId: {
        'node-1': { percent: '20' },
        'node-2': { percent: '100' },
      },
      userSetSampleNodeIds: { 'node-1': true, 'node-2': true },
    });
  });
});
