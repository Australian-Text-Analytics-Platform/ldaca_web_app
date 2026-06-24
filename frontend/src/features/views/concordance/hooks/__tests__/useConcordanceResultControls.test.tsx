import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useConcordanceResultControls } from '../useConcordanceResultControls';

describe('useConcordanceResultControls', () => {
  it('applies a global page size to every tracked node and resets pages', () => {
    const { result } = renderHook(() => useConcordanceResultControls({ results: null }));

    act(() => {
      result.current.setNodePagination({
        'node-1': { currentPage: 3, pageSize: 20, sortBy: 'speaker', descending: true },
        'node-2': { currentPage: 2, pageSize: 20, sortBy: '', descending: false },
      });
      result.current.applyGlobalPageSize(50);
    });

    expect(result.current.globalPageSize).toBe(50);
    expect(result.current.nodePagination).toEqual({
      'node-1': { currentPage: 1, pageSize: 50, sortBy: 'speaker', descending: true },
      'node-2': { currentPage: 1, pageSize: 50, sortBy: '', descending: false },
    });
  });

  it('parses materialize summaries from hydrated request payloads', () => {
    const { result } = renderHook(() => useConcordanceResultControls({ results: null }));

    act(() => {
      result.current.applyHydratedMaterializeSummaries({
        'node-1': {
          record_count: 12,
          unique_documents_with_hits: 4,
          total_source_documents: 9,
        },
        'node-2': {
          record_count: '3',
          unique_documents_with_hits: '2',
          total_source_documents: '5',
        },
      });
    });

    expect(result.current.materializeSummaries).toEqual({
      'node-1': { recordCount: 12, uniqueDocuments: 4, totalDocuments: 9 },
      'node-2': { recordCount: 3, uniqueDocuments: 2, totalDocuments: 5 },
    });
  });

  it('resets pagination and summaries after clear', () => {
    const { result } = renderHook(() => useConcordanceResultControls({ results: null }));

    act(() => {
      result.current.setNodePagination({
        'node-1': { currentPage: 3, pageSize: 20, sortBy: '', descending: false },
      });
      result.current.applyHydratedMaterializeSummaries({
        'node-1': {
          record_count: 12,
          unique_documents_with_hits: 4,
          total_source_documents: 9,
        },
      });
      result.current.resetAfterClear();
    });

    expect(result.current.nodePagination).toEqual({});
    expect(result.current.materializeSummaries).toEqual({});
  });

  it('hydrates page size from the first result load only', async () => {
    const firstResult = {
      state: 'successful' as const,
      message: 'ok',
      preferences: { page_size: 50 },
      analysis_params: {},
      data: {
        'node-1': {
          data: [],
          columns: [],
          metadata: { metadata_columns: [], concordance_columns: [], all_columns: [] },
          pagination: {
            page: 1,
            page_size: 30,
            total_source_rows: 0,
            total_source_pages: 1,
            result_count: 0,
            has_prev: false,
            has_next: false,
          },
          sorting: { descending: false },
        },
      },
    };

    const { result, rerender } = renderHook(
      ({ results }) => useConcordanceResultControls({ results }),
      { initialProps: { results: firstResult } },
    );

    await waitFor(() => {
      expect(result.current.globalPageSize).toBe(50);
    });

    act(() => {
      result.current.applyGlobalPageSize(100);
    });

    rerender({
      results: {
        ...firstResult,
        preferences: { page_size: 25 },
      },
    });

    await new Promise((resolve) => requestAnimationFrame(resolve));

    expect(result.current.globalPageSize).toBe(100);
  });
});
