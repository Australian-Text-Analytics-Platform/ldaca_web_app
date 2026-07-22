import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { QuotationAnalysisResponse } from '@/api';
import { QUOTATION_COLUMN_KEYS } from '../../../common/generatedColumns';
import { useQuotationResultControls } from '../useQuotationResultControls';

const response: QuotationAnalysisResponse = {
  data: [[{ text: 'Alice said hello.', [QUOTATION_COLUMN_KEYS.quote]: 'hello' }]],
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
    result_count: 1,
    has_next: false,
    has_prev: true,
  },
  sorting: { sort_by: 'text', descending: true },
};

describe('useQuotationResultControls', () => {
  it('normalizes a canonical quotation result and owns only transient detach state', () => {
    const { result } = renderHook(() =>
      useQuotationResultControls({ result: response, nodeId: 'node-1', column: 'text' }),
    );
    expect(result.current.resultsByNode['node-1']?.rows).toHaveLength(1);
    expect(result.current.nodeState['node-1']).toEqual({
      currentPage: 3,
      pageSize: 50,
      sortBy: 'text',
      descending: true,
    });
    act(() => result.current.setNodeDetaching({ 'node-1': true }));
    expect(result.current.nodeDetaching).toEqual({ 'node-1': true });
  });
});
