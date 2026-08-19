import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getAnalysisResultResource } from '../analysisApi';

const { getAnalysisMock, getAnalysisResultMock, queryAnalysisResultMock } = vi.hoisted(() => ({
  getAnalysisMock: vi.fn(),
  getAnalysisResultMock: vi.fn(),
  queryAnalysisResultMock: vi.fn(),
}));

vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal()),
  getAnalysis: getAnalysisMock,
  getAnalysisResult: getAnalysisResultMock,
  queryAnalysisResult: queryAnalysisResultMock,
}));

describe('getAnalysisResultResource', () => {
  beforeEach(() => {
    getAnalysisMock.mockReset();
    getAnalysisResultMock.mockReset();
    queryAnalysisResultMock.mockReset();
  });

  it('loads an output-only Result without refetching its Analysis resource', async () => {
    const output = {
      kind: 'quotation',
      data: [],
      columns: [],
      metadata: {
        concordance_columns: [],
        quotation_columns: [],
        metadata_columns: [],
        all_columns: [],
      },
      pagination: {
        page: 1,
        page_size: 50,
        total_source_rows: 0,
        total_source_pages: 0,
        result_count: 0,
        has_next: false,
        has_prev: false,
      },
      sorting: { sort_by: null, descending: false },
      query: { kind: 'quotation', page: 1, page_size: 50, sort_by: null, descending: false },
    };
    getAnalysisResultMock.mockResolvedValue({ data: output });

    await expect(getAnalysisResultResource('workspace-1', 'analysis-1')).resolves.toEqual(output);
    expect(getAnalysisMock).not.toHaveBeenCalled();
    expect(getAnalysisResultMock).toHaveBeenCalledTimes(1);
  });

  it('returns every Topic without client-side pagination', async () => {
    const topic = (id: number) => ({
      id,
      label: `Topic ${String(id)}`,
      representative_words: [],
      size: [1],
      total_size: 1,
      x: id,
      y: id,
    });
    const common = {
      kind: 'topic_modeling' as const,
      corpus_sizes: [501],
      per_corpus_topic_counts: null,
      meta: { node_names: ['Corpus'], truncated_segment_count: 7 },
      artifacts: { version: 1 as const, topic_meanings_parquet_path: {}, nodes: [] },
    };
    getAnalysisResultMock.mockResolvedValue({
      data: {
        ...common,
        topics: Array.from({ length: 501 }, (_, index) => topic(index)),
        query: { kind: 'topic_modeling' },
      },
    });

    const result = await getAnalysisResultResource<{
      data: { topics: { id: number }[]; meta: { truncated_segment_count?: number } };
    }>('workspace-1', 'analysis-1');

    expect(result?.data.topics).toHaveLength(501);
    expect(result?.data.topics.at(-1)?.id).toBe(500);
    expect(result?.data.meta.truncated_segment_count).toBe(7);
    expect(queryAnalysisResultMock).not.toHaveBeenCalled();
  });

  it('sends the complete cluster and Top-N projection query', async () => {
    queryAnalysisResultMock.mockResolvedValue({
      data: {
        kind: 'topic_modeling',
        topics: [],
        corpus_sizes: [],
        per_corpus_topic_counts: [],
        meta: {},
        sources: [],
        clustering: {
          cluster_count: 3,
          min_cluster_count: 2,
          max_cluster_count: 4,
          default_cluster_count: 4,
          adjustable: true,
        },
        topic_inclusion: {
          top_n_topics: 2,
          min_top_n_topics: 1,
          max_top_n_topics: 3,
          default_top_n_topics: 2,
          adjustable: true,
        },
        query: {
          kind: 'topic_modeling',
          cluster_count: 3,
          top_n_topics: 2,
        },
      },
    });

    await getAnalysisResultResource('workspace-1', 'analysis-1', {
      kind: 'topic_modeling',
      cluster_count: 3,
      top_n_topics: 2,
    });

    expect(queryAnalysisResultMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: {
          kind: 'topic_modeling',
          cluster_count: 3,
          top_n_topics: 2,
        },
      }),
    );
  });
});
