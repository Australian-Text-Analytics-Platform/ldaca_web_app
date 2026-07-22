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

  it('drains every topic page before returning a Topic Modeling Result', async () => {
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
      meta: { node_names: ['Corpus'] },
      artifacts: { version: 1 as const, topic_meanings_parquet_path: {}, nodes: [] },
    };
    getAnalysisResultMock.mockResolvedValue({
      data: {
        ...common,
        topics: [topic(0)],
        pagination: { page: 1, page_size: 50, total_rows: 501, total_pages: 11 },
        query: { kind: 'topic_modeling', page: 1, page_size: 50 },
      },
    });
    queryAnalysisResultMock
      .mockResolvedValueOnce({
        data: {
          ...common,
          topics: Array.from({ length: 500 }, (_, index) => topic(index)),
          pagination: { page: 1, page_size: 500, total_rows: 501, total_pages: 2 },
          query: { kind: 'topic_modeling', page: 1, page_size: 500 },
        },
      })
      .mockResolvedValueOnce({
        data: {
          ...common,
          topics: [topic(500)],
          pagination: { page: 2, page_size: 500, total_rows: 501, total_pages: 2 },
          query: { kind: 'topic_modeling', page: 2, page_size: 500 },
        },
      });

    const result = await getAnalysisResultResource<{
      data: { topics: { id: number }[] };
    }>('workspace-1', 'analysis-1');

    expect(result?.data.topics).toHaveLength(501);
    expect(result?.data.topics.at(-1)?.id).toBe(500);
    expect(queryAnalysisResultMock).toHaveBeenCalledTimes(2);
    expect(queryAnalysisResultMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        body: expect.objectContaining({ kind: 'topic_modeling', page: 2, page_size: 500 }),
      }),
    );
  });
});
