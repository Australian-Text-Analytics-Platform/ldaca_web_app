import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { QuotationAnalysisResponse } from '@/api/text';
import { useQuotationTaskFlow } from '../useQuotationTaskFlow';

const buildQuotationResponse = (): QuotationAnalysisResponse => ({
  data: [],
  columns: [],
  metadata: {
    quotation_columns: [],
    metadata_columns: [],
    all_columns: [],
  },
  pagination: {
    page: 1,
    page_size: 20,
    total_source_rows: 0,
    total_source_pages: 0,
    result_count: 0,
    has_next: false,
    has_prev: false,
  },
  sorting: {
    sort_by: null,
    descending: false,
  },
});

describe('useQuotationTaskFlow', () => {
  it('omits page_size on the initial quotation request so the backend can estimate it', async () => {
    const quotationSearch = vi.fn(async () => buildQuotationResponse());

    const { result } = renderHook(() =>
      useQuotationTaskFlow({
        state: {
          currentWorkspaceId: 'workspace-1',
          isLocked: false,
          hasLoaded: false,
          lockedNodesSnapshot: [],
          displayedNodes: [{ id: 'node-1', name: 'Node 1' }],
          activeSelections: [{ nodeId: 'node-1', column: 'text' }],
          nodeState: {},
          originalColumnsByNode: { 'node-1': ['text'] },
          resolvedEnginePayload: { type: 'local' },
          engineConfigUrl: '',
        },
        actions: {
          setEngineError: vi.fn(),
          updateRemoteUrl: vi.fn(),
          setIsLoadingQuotations: vi.fn(),
          setHasLoaded: vi.fn(),
          setNodeDetaching: vi.fn(),
          setNodeMaterializing: vi.fn(),
          setMaterializeTaskIds: vi.fn(),
          showErrorDialog: vi.fn(),
          baseHandlePageChange: vi.fn(),
          baseHandlePageSizeChange: vi.fn(),
          updateResultState: vi.fn(),
          applyContextLengthPreferenceFromResult: vi.fn(),
          setLocalTaskId: vi.fn(),
        },
        lock: {
          getAuthHeaders: () => ({}),
          lockWithSnapshots: vi.fn(),
          resolveTaskId: vi.fn(async () => null),
          quotationSearch,
          detachQuotation: vi.fn(async () => undefined),
          materializeQuotation: vi.fn(async () => undefined),
          openEngineDialog: vi.fn(),
        },
      })
    );

    await act(async () => {
      await result.current.fetchQuotations('node-1');
    });

    expect(quotationSearch).toHaveBeenCalledTimes(1);
    expect(quotationSearch).toHaveBeenCalledWith(
      'node-1',
      expect.objectContaining({
        column: 'text',
        page: 1,
        engine: { type: 'local' },
      })
    );
    const initialRequest = quotationSearch.mock.calls[0]?.at(1) as
      | Record<string, unknown>
      | undefined;
    expect(initialRequest).toBeDefined();
    expect(initialRequest).not.toHaveProperty('page_size');
  });

  it('keeps sending page_size after the user has an explicit pagination state', async () => {
    const quotationSearch = vi.fn(async () => buildQuotationResponse());

    const { result } = renderHook(() =>
      useQuotationTaskFlow({
        state: {
          currentWorkspaceId: 'workspace-1',
          isLocked: false,
          hasLoaded: true,
          lockedNodesSnapshot: [],
          displayedNodes: [{ id: 'node-1', name: 'Node 1' }],
          activeSelections: [{ nodeId: 'node-1', column: 'text' }],
          nodeState: {
            'node-1': {
              currentPage: 1,
              pageSize: 50,
              sortBy: undefined,
              descending: false,
            },
          },
          originalColumnsByNode: { 'node-1': ['text'] },
          resolvedEnginePayload: { type: 'local' },
          engineConfigUrl: '',
        },
        actions: {
          setEngineError: vi.fn(),
          updateRemoteUrl: vi.fn(),
          setIsLoadingQuotations: vi.fn(),
          setHasLoaded: vi.fn(),
          setNodeDetaching: vi.fn(),
          setNodeMaterializing: vi.fn(),
          setMaterializeTaskIds: vi.fn(),
          showErrorDialog: vi.fn(),
          baseHandlePageChange: vi.fn(),
          baseHandlePageSizeChange: vi.fn(),
          updateResultState: vi.fn(),
          applyContextLengthPreferenceFromResult: vi.fn(),
          setLocalTaskId: vi.fn(),
        },
        lock: {
          getAuthHeaders: () => ({}),
          lockWithSnapshots: vi.fn(),
          resolveTaskId: vi.fn(async () => 'task-1'),
          quotationSearch,
          detachQuotation: vi.fn(async () => undefined),
          materializeQuotation: vi.fn(async () => undefined),
          openEngineDialog: vi.fn(),
        },
      })
    );

    await act(async () => {
      await result.current.fetchQuotations('node-1');
    });

    const paginatedRequest = quotationSearch.mock.calls[0]?.at(1) as
      | Record<string, unknown>
      | undefined;
    expect(paginatedRequest).toBeDefined();
    expect(paginatedRequest).toMatchObject({
      page_size: 50,
    });
  });
});