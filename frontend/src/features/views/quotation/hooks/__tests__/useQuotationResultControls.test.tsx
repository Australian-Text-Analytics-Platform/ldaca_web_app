import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { QuotationAnalysisResponse } from '@/api';
import { QUOTATION_COLUMN_KEYS } from '../../../common/generatedColumns';
import { useQuotationResultControls } from '../useQuotationResultControls';

const buildQuotationResponse = (): QuotationAnalysisResponse => ({
  data: [
    [
      {
        text: 'Alice said hello.',
        [QUOTATION_COLUMN_KEYS.speaker]: 'Alice',
        [QUOTATION_COLUMN_KEYS.speakerStartIdx]: 0,
        [QUOTATION_COLUMN_KEYS.speakerEndIdx]: 5,
        [QUOTATION_COLUMN_KEYS.quote]: 'hello',
        [QUOTATION_COLUMN_KEYS.quoteStartIdx]: 11,
        [QUOTATION_COLUMN_KEYS.quoteEndIdx]: 16,
        [QUOTATION_COLUMN_KEYS.verb]: 'said',
        [QUOTATION_COLUMN_KEYS.verbStartIdx]: 6,
        [QUOTATION_COLUMN_KEYS.verbEndIdx]: 10,
      },
    ],
  ],
  columns: ['text', QUOTATION_COLUMN_KEYS.quote],
  metadata: {
    quotation_columns: [QUOTATION_COLUMN_KEYS.quote],
    metadata_columns: ['source'],
    all_columns: ['text', 'source', QUOTATION_COLUMN_KEYS.quote],
  },
  pagination: {
    page: 3,
    page_size: 50,
    total_source_rows: 120,
    total_source_pages: 3,
    result_count: 20,
    has_next: false,
    has_prev: true,
  },
  sorting: {
    sort_by: 'text',
    descending: true,
  },
});

describe('useQuotationResultControls', () => {
  it('stores normalized rows and matching node pagination from a result', () => {
    const { result } = renderHook(() => useQuotationResultControls());

    act(() => {
      result.current.updateResultState('node-1', 'text', buildQuotationResponse());
    });

    expect(result.current.resultsByNode['node-1']?.rows).toHaveLength(1);
    expect(result.current.resultsByNode['node-1']?.rows[0]?.spans).toEqual([
      { start: 0, end: 5, type: 'speaker' },
      { start: 11, end: 16, type: 'quote' },
      { start: 6, end: 10, type: 'verb' },
    ]);
    expect(result.current.nodeState['node-1']).toEqual({
      currentPage: 3,
      pageSize: 50,
      sortBy: 'text',
      descending: true,
    });
  });

  it('hydrates materialized path and summary values from a request payload', () => {
    const { result } = renderHook(() => useQuotationResultControls());

    act(() => {
      result.current.applyMaterializedRequest('node-1', '/tmp/quotations.parquet', {
        record_count: '42',
        unique_documents_with_hits: 7,
        total_source_documents: 10,
      });
    });

    expect(result.current.materializedPaths).toEqual({
      'node-1': '/tmp/quotations.parquet',
    });
    expect(result.current.materializeSummary).toEqual({
      recordCount: 42,
      uniqueDocuments: 7,
      totalDocuments: 10,
    });
  });

  it('removes stale materialized path markers when a refreshed request no longer has one', () => {
    const { result } = renderHook(() => useQuotationResultControls());

    act(() => {
      result.current.applyMaterializedRequest('node-1', '/tmp/quotations.parquet', {
        record_count: 42,
        unique_documents_with_hits: 7,
        total_source_documents: 10,
      });
      result.current.applyMaterializedRequest('node-1', null, undefined);
    });

    expect(result.current.materializedPaths).toEqual({});
    expect(result.current.materializeSummary).toBeNull();
  });

  it('keeps React set-state compatible map setters for task flow and materialize lifecycle callers', () => {
    const { result } = renderHook(() => useQuotationResultControls());

    act(() => {
      result.current.setNodeDetaching({ 'node-1': true });
      result.current.setNodeMaterializing({ 'node-1': true });
      result.current.setMaterializeTaskIds({ 'node-1': 'task-1' });
    });

    expect(result.current.nodeDetaching).toEqual({ 'node-1': true });
    expect(result.current.nodeMaterializing).toEqual({ 'node-1': true });
    expect(result.current.materializeTaskIds).toEqual({ 'node-1': 'task-1' });

    act(() => {
      result.current.setNodeDetaching((prev) => ({ ...prev, 'node-1': false }));
      result.current.setNodeMaterializing((prev) => {
        const { 'node-1': _removed, ...next } = prev;
        void _removed;
        return next;
      });
      result.current.setMaterializeTaskIds((prev) => {
        const { 'node-1': _removed, ...next } = prev;
        void _removed;
        return next;
      });
    });

    expect(result.current.nodeDetaching).toEqual({ 'node-1': false });
    expect(result.current.nodeMaterializing).toEqual({});
    expect(result.current.materializeTaskIds).toEqual({});
  });

  it('resets result-specific state after clear, including stale materialized paths', () => {
    const { result } = renderHook(() => useQuotationResultControls());

    act(() => {
      result.current.updateResultState('node-1', 'text', buildQuotationResponse());
      result.current.applyMaterializedRequest('node-1', '/tmp/quotations.parquet', {
        record_count: 42,
        unique_documents_with_hits: 7,
        total_source_documents: 10,
      });
      result.current.resetAfterClear();
    });

    expect(result.current.resultsByNode).toEqual({});
    expect(result.current.nodeState).toEqual({});
    expect(result.current.materializedPaths).toEqual({});
    expect(result.current.materializeSummary).toBeNull();
  });
});
