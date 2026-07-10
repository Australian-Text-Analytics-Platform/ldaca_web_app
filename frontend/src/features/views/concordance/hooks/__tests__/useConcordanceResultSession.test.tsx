import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { analysisTaskDispersionBins } from '@/api';
import type { ConcordanceAnalysisResponse } from '@/api';
import { projectWorkspaceNodeMetadata } from '@/features/workspace/common/workspaceNodeMetadata';
import { useConcordanceResultSession } from '../useConcordanceResultSession';

vi.mock('@/api', () => ({
  analysisTaskDispersionBins: vi.fn(),
}));

const mockedAnalysisTaskDispersionBins = vi.mocked(analysisTaskDispersionBins);

const makeResult = (pageSize = 20): ConcordanceAnalysisResponse => ({
  state: 'successful',
  message: 'ok',
  metadata: { task_id: 'task-1' },
  preferences: { page_size: pageSize },
  analysis_params: {
    label_to_node_map: { 'Left result': 'node-1' },
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
        page_size: pageSize,
        total_source_rows: 1,
        total_source_pages: 1,
        result_count: 1,
        has_next: false,
        has_prev: false,
      },
      sorting: { sort_by: null, descending: false },
    },
  },
});

const defaultOptions = {
  workspaceId: 'workspace-1',
  selectedNodes: [
    projectWorkspaceNodeMetadata({ id: 'node-1', name: 'Left Corpus' }),
    projectWorkspaceNodeMetadata({ id: 'node-2', name: 'Right Corpus' }),
  ],
  showDispersion: true,
  proportionalDispersionBars: false,
  colourMatches: true,
  lowercaseMatches: true,
};

describe('useConcordanceResultSession', () => {
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

  it('owns canonical task identity, display maps, and whole-corpus bin queries', async () => {
    const { result } = renderHook(() => useConcordanceResultSession(defaultOptions));

    act(() => {
      result.current.setResults(makeResult());
      result.current.hydrateMaterialization({ 'node-1': '/tmp/node-1.parquet' }, undefined);
    });

    expect(result.current.taskId).toBe('task-1');
    expect(result.current.labelToNodeId).toEqual({ 'Left result': 'node-1' });
    expect(result.current.nodeColors['node-1']).toBe('#2563eb');
    expect(result.current.sourceColorMap['left corpus']).toBe(result.current.nodeColors['node-1']);

    await waitFor(() => {
      expect(mockedAnalysisTaskDispersionBins).toHaveBeenCalledWith({
        path: { workspace_id: 'workspace-1', task_id: 'task-1' },
        query: { node_id: 'node-1' },
        signal: expect.any(AbortSignal),
        throwOnError: true,
      });
    });
    await waitFor(() => {
      expect(result.current.getMaterializedBinsForKey('node-1')).toEqual([
        { bin_idx: 0, matched_text: 'Alpha', count: 2, __source_node: 'Left Corpus' },
      ]);
    });
    expect(result.current.allMatchedTexts).toEqual(['alpha']);
  });

  it('does not accept the removed camelCase task-id compatibility shape', () => {
    const { result } = renderHook(() => useConcordanceResultSession(defaultOptions));

    act(() => {
      result.current.setResults({
        ...makeResult(),
        metadata: { taskId: 'legacy-task' },
      });
    });

    expect(result.current.taskId).toBe('');
  });

  it('applies shared page size and hydrates materialization in one transition', () => {
    const { result } = renderHook(() => useConcordanceResultSession(defaultOptions));

    act(() => {
      result.current.setNodePagination({
        'node-1': { currentPage: 3, pageSize: 20, sortBy: 'speaker', descending: true },
        'node-2': { currentPage: 2, pageSize: 20, sortBy: '', descending: false },
      });
      result.current.applyGlobalPageSize(50);
      result.current.hydrateMaterialization(
        { 'node-1': '/tmp/node-1.parquet' },
        {
          'node-1': {
            record_count: '12',
            unique_documents_with_hits: 4,
            total_source_documents: '9',
          },
        },
      );
    });

    expect(result.current.nodePagination).toEqual({
      'node-1': { currentPage: 1, pageSize: 50, sortBy: 'speaker', descending: true },
      'node-2': { currentPage: 1, pageSize: 50, sortBy: '', descending: false },
    });
    expect(result.current.materializedPaths).toEqual({
      'node-1': '/tmp/node-1.parquet',
    });
    expect(result.current.materializeSummaries).toEqual({
      'node-1': { recordCount: 12, uniqueDocuments: 4, totalDocuments: 9 },
    });
  });

  it('hydrates page size once per canonical task identity', async () => {
    const { result } = renderHook(() => useConcordanceResultSession(defaultOptions));

    act(() => {
      result.current.setResults(makeResult(50));
    });
    await waitFor(() => {
      expect(result.current.globalPageSize).toBe(50);
    });

    act(() => {
      result.current.applyGlobalPageSize(100);
      result.current.setResults(makeResult(25));
    });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(result.current.globalPageSize).toBe(100);

    act(() => {
      result.current.setResults({
        ...makeResult(25),
        metadata: { task_id: 'task-2' },
      });
    });
    await waitFor(() => {
      expect(result.current.globalPageSize).toBe(25);
    });
  });

  it('clears every result-scoped cache and progress map together', () => {
    const { result } = renderHook(() => useConcordanceResultSession(defaultOptions));

    act(() => {
      result.current.setResults(makeResult());
      result.current.setNodePagination({
        'node-1': { currentPage: 3, pageSize: 20, sortBy: '', descending: false },
      });
      result.current.setNodeLoading({ 'node-1': true });
      result.current.setNodeMaterializing({ 'node-1': true });
      result.current.setMaterializeTaskIds({ 'node-1': 'materialize-1' });
      result.current.hydrateMaterialization({ 'node-1': '/tmp/node-1.parquet' }, undefined);
      result.current.reset();
    });

    expect(result.current.results).toBeNull();
    expect(result.current.nodePagination).toEqual({});
    expect(result.current.nodeLoading).toEqual({});
    expect(result.current.nodeMaterializing).toEqual({});
    expect(result.current.materializeTaskIds).toEqual({});
    expect(result.current.materializedPaths).toEqual({});
    expect(result.current.materializedBins).toEqual({});
  });
});
