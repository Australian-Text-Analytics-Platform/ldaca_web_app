import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import { projectWorkspaceNodeMetadata } from '@/features/workspace/common/workspaceNodeMetadata';
import type { ConcordanceAnalysisResponse } from '@/api';
import type { ConcordanceRunAllReviewSource } from '../../concordanceRunAllReview';
import { useConcordanceResultSession } from '../useConcordanceResultSession';

const getConcordanceTableDensityMock = vi.hoisted(() => vi.fn());
const queryConcordanceDocumentProjectionTableMock = vi.hoisted(() => vi.fn());

vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal()),
  getConcordanceTableDensity: getConcordanceTableDensityMock,
}));

vi.mock('@/api/tableApi', () => ({
  queryConcordanceDocumentProjectionTable: queryConcordanceDocumentProjectionTableMock,
}));

const result: ConcordanceAnalysisResponse = {
  kind: 'concordance',
  sources: [],
  metadata: {
    metadata_columns: [],
    concordance_columns: ['CONC_matched_text'],
    quotation_columns: [],
    all_columns: ['CONC_matched_text'],
  },
  query: { page: 1, page_size: 20 },
  data: {
    'node-1': {
      data: [[{ CONC_matched_text: 'Alpha' }, { CONC_matched_text: 'beta' }]],
      columns: ['CONC_matched_text'],
      metadata: {
        metadata_columns: [],
        concordance_columns: ['CONC_matched_text'],
        quotation_columns: [],
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
};

const createWrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
};

const reviewSource: ConcordanceRunAllReviewSource = {
  analysisId: 'review-analysis-1',
  source: {
    analysis_columns: ['CONC_matched_text'],
    color: null,
    document_column: 'text',
    document_count: 25,
    internal_columns: ['__wordflow_source_row_id'],
    match_count: 25,
    metadata_columns: [],
    node_id: 'node-1',
    node_name: 'Corpus',
    table: {
      delivery: 'projected',
      table_id: 'concordance-run-all',
      documents: { rows_url: '/documents/rows', schema_url: '/documents/schema' },
      matches: { rows_url: '/matches/rows', schema_url: '/matches/schema' },
      density_url: '/density',
    },
  },
};

const secondReviewSource: ConcordanceRunAllReviewSource = {
  ...reviewSource,
  analysisId: 'review-analysis-2',
  source: {
    ...reviewSource.source,
    node_id: 'node-2',
    node_name: 'Second Corpus',
    table: {
      ...reviewSource.source.table,
      table_id: 'concordance-run-all-2',
    },
  },
};

describe('useConcordanceResultSession', () => {
  it('projects the canonical analysis result into Data Block display colors', () => {
    const { result: hook } = renderHook(
      () =>
        useConcordanceResultSession({
          workspaceId: 'workspace-1',
          analysisId: 'analysis-1',
          baseResult: result,
          viewMode: 'separated',
          combinedPage: 1,
          selectedNodes: [projectWorkspaceNodeMetadata({ id: 'node-1', name: 'Corpus' })],
          showDispersion: true,
          selectedBinIndices: {},
          excludedMatchedTexts: new Set(),
          binCount: 20,
        }),
      { wrapper: createWrapper() },
    );

    expect(hook.current.nodeColors['node-1']).toBe('#2563eb');
    expect(hook.current.sourceColorMap.corpus).toBe('#2563eb');
  });

  it('clears result pagination and loading state when reset', () => {
    const { result: hook } = renderHook(
      () =>
        useConcordanceResultSession({
          workspaceId: null,
          analysisId: null,
          baseResult: null,
          viewMode: 'separated',
          combinedPage: 1,
          selectedNodes: [],
          showDispersion: false,
          selectedBinIndices: {},
          excludedMatchedTexts: new Set(),
          binCount: 20,
        }),
      { wrapper: createWrapper() },
    );
    act(() => {
      hook.current.setNodePagination({
        'node-1': { currentPage: 2, pageSize: 20, sortBy: '', descending: false },
      });
      hook.current.reset();
    });
    expect(hook.current.results).toBeNull();
    expect(hook.current.nodePagination).toEqual({});
    expect(hook.current.nodeLoading).toEqual({});
  });

  it('keeps a new Dispersion Review page unsorted', () => {
    const { result: hook } = renderHook(
      () =>
        useConcordanceResultSession({
          workspaceId: null,
          analysisId: null,
          baseResult: null,
          viewMode: 'separated',
          combinedPage: 1,
          selectedNodes: [],
          showDispersion: true,
          reviewSources: [reviewSource],
          selectedBinIndices: {},
          excludedMatchedTexts: new Set(),
          binCount: 20,
        }),
      { wrapper: createWrapper() },
    );

    act(() => {
      hook.current.handleReviewPageChange(2, 'node-1');
    });

    expect(hook.current.nodePagination['node-1']).toEqual({
      currentPage: 2,
      pageSize: 20,
      sortBy: undefined,
      descending: false,
    });
  });

  it('applies one exact-term exclusion set to every source projection', async () => {
    queryConcordanceDocumentProjectionTableMock.mockResolvedValue({
      table: {},
      columns: [],
      schema: [],
      rows: [],
      hasNext: false,
      etag: 'document-page',
    });
    getConcordanceTableDensityMock.mockResolvedValue({
      data: { resolution: 100, document_count: 0, match_count: 0, series: [] },
    });

    renderHook(
      () =>
        useConcordanceResultSession({
          workspaceId: 'workspace-1',
          analysisId: 'analysis-1',
          baseResult: null,
          viewMode: 'separated',
          combinedPage: 1,
          selectedNodes: [
            projectWorkspaceNodeMetadata({ id: 'node-1', name: 'Corpus' }),
            projectWorkspaceNodeMetadata({ id: 'node-2', name: 'Second Corpus' }),
          ],
          showDispersion: true,
          reviewSources: [reviewSource, secondReviewSource],
          selectedBinIndices: {},
          excludedMatchedTexts: new Set(['jobs']),
          binCount: 20,
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(queryConcordanceDocumentProjectionTableMock).toHaveBeenCalledTimes(2);
    });
    for (const [request] of queryConcordanceDocumentProjectionTableMock.mock.calls) {
      expect(request.body.excluded_matched_texts).toEqual(['jobs']);
    }
  });
});
