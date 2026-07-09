import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { analysisTaskDispersionBins } from '@/api';
import type { ConcordanceAnalysisResponse } from '@/api';
import { useConcordanceResultViewModel } from '../useConcordanceResultViewModel';

vi.mock('@/api', () => ({
  analysisTaskDispersionBins: vi.fn(),
}));

const mockedAnalysisTaskDispersionBins = vi.mocked(analysisTaskDispersionBins);

const getAuthHeaders = vi.fn(() => ({ Authorization: 'Bearer test-token' }));

const makeResult = (): ConcordanceAnalysisResponse =>
  ({
    state: 'successful',
    message: 'ok',
    metadata: { task_id: 'task-1' },
    analysis_params: {
      label_to_node_map: {
        'Left result': 'node-1',
      },
    },
    data: {
      'node-1': {
        data: [[{ CONC_matched_text: 'Fallback' }]],
        columns: ['CONC_matched_text'],
        metadata: {
          concordance_columns: ['CONC_matched_text'],
          metadata_columns: [],
          all_columns: ['CONC_matched_text'],
        },
        pagination: {
          page: 1,
          page_size: 20,
          total_source_rows: 1,
          total_source_pages: 1,
          result_count: 1,
          has_next: false,
          has_prev: false,
        },
        sorting: { sort_by: null, descending: false },
      },
    },
  }) as unknown as ConcordanceAnalysisResponse;

const defaultArgs = {
  workspaceId: 'workspace-1',
  results: makeResult(),
  concordanceTaskId: 'task-1',
  panelSelectedNodes: [
    { id: 'node-1', name: 'Left Corpus' },
    { id: 'node-2', name: 'Right Corpus' },
  ],
  showDispersion: true,
  proportionalDispersionBars: false,
  colourMatches: true,
  lowercaseMatches: true,
  getAuthHeaders,
};

describe('useConcordanceResultViewModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedAnalysisTaskDispersionBins.mockResolvedValue({
      data: {
        bin_count: 100,
        node_id: 'node-1',
        rows: [{ bin_idx: 0, matched_text: 'Alpha', count: 2 }],
        total_hits: 2,
      },
      error: undefined,
    });
  });

  it('fetches missing materialized bins and exposes tagged lookup rows', async () => {
    const { result } = renderHook(() => useConcordanceResultViewModel(defaultArgs));

    expect(result.current.labelToNodeId).toEqual({ 'Left result': 'node-1' });
    expect(result.current.nodeColors['node-1']).toBe('#2563eb');
    expect(result.current.sourceColorMap['left corpus']).toBe(result.current.nodeColors['node-1']);

    act(() => {
      result.current.setMaterializedPaths({ 'node-1': '/tmp/node-1.parquet' });
    });

    await waitFor(() => {
      expect(mockedAnalysisTaskDispersionBins).toHaveBeenCalledWith({
        headers: { Authorization: 'Bearer test-token' },
        path: { workspace_id: 'workspace-1', task_id: 'task-1' },
        query: { node_id: 'node-1' },
        throwOnError: true,
      });
    });

    await waitFor(() => {
      expect(result.current.getMaterializedBinsForKey('node-1')).toEqual([
        { bin_idx: 0, matched_text: 'Alpha', count: 2, __source_node: 'Left Corpus' },
      ]);
    });
    expect(result.current.allMatchedTexts).toEqual(['alpha']);
    expect(result.current.matchedTextColorMap.alpha).toBeDefined();
  });

  it('does not request whole-corpus bins while proportional bars are active', async () => {
    const { result } = renderHook(() =>
      useConcordanceResultViewModel({
        ...defaultArgs,
        proportionalDispersionBars: true,
      }),
    );

    act(() => {
      result.current.setMaterializedPaths({ 'node-1': '/tmp/node-1.parquet' });
    });

    await new Promise((resolve) => requestAnimationFrame(resolve));

    expect(mockedAnalysisTaskDispersionBins).not.toHaveBeenCalled();
    expect(result.current.getMaterializedBinsForKey('node-1')).toBeUndefined();
  });
});
