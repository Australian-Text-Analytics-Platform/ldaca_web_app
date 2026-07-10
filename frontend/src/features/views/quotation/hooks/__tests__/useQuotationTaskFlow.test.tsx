import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { QuotationAnalysisResponse } from '@/api';
import { useQuotationTaskFlow } from '../useQuotationTaskFlow';

// Builds the minimal successful quotation response shape consumed by task-flow assertions.
/**
 * Called by: Vitest cases in this file to exercise the scoped analysis behavior because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
 * Steps: arrange fixtures and mocks, run the hook or component path under test, then assert the visible behavior or generated payload.
 */
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
    const quotationSearch = vi.fn(() => Promise.resolve(buildQuotationResponse()));

    const { result } = renderHook(() =>
      useQuotationTaskFlow({
        state: {
          currentWorkspaceId: 'workspace-1',
          hasLoaded: false,
          displayedNodes: [{ id: 'node-1', name: 'Node 1' }],
          activeSelections: [{ nodeId: 'node-1', column: 'text' }],
          nodeState: {},
          originalColumnsByNode: { 'node-1': ['text'] },
          buildEngineRequest: () => ({ type: 'local' }),
        },
        actions: {
          setIsLoadingQuotations: vi.fn(),
          setHasLoaded: vi.fn(),
          setNodeDetaching: vi.fn(),
          setNodeMaterializing: vi.fn(),
          setMaterializeTaskIds: vi.fn(),
          showErrorDialog: vi.fn(),
          updateResultState: vi.fn(),
          applyContextLengthPreferenceFromResult: vi.fn(),
          setLocalTaskId: vi.fn(),
        },
        lock: {
          // Keeps task resolution empty so this test isolates initial request shaping.
          // Called by: the Vitest cases in this file through its owning hook, JSX prop, or analysis lifecycle config because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
          resolveTaskId: vi.fn(() => Promise.resolve(null)),
          quotationSearch,
          detachQuotation: vi.fn(() =>
            Promise.resolve({
              state: 'running' as const,
              message: 'Quotation detach started',
              data: null,
              metadata: { task_id: 'quotation-detach-task' },
            }),
          ),
          materializeQuotation: vi.fn(() => Promise.resolve(undefined)),
        },
      }),
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
      }),
    );
    const initialRequest = (quotationSearch.mock.calls[0] as unknown[] | undefined)?.[1] as
      | Record<string, unknown>
      | undefined;
    expect(initialRequest).toBeDefined();
    expect(initialRequest).not.toHaveProperty('page_size');
  });

  it('keeps sending page_size after the user has an explicit pagination state', async () => {
    const quotationSearch = vi.fn(() => Promise.resolve(buildQuotationResponse()));

    const { result } = renderHook(() =>
      useQuotationTaskFlow({
        state: {
          currentWorkspaceId: 'workspace-1',
          hasLoaded: true,
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
          buildEngineRequest: () => ({ type: 'local' }),
        },
        actions: {
          setIsLoadingQuotations: vi.fn(),
          setHasLoaded: vi.fn(),
          setNodeDetaching: vi.fn(),
          setNodeMaterializing: vi.fn(),
          setMaterializeTaskIds: vi.fn(),
          showErrorDialog: vi.fn(),
          updateResultState: vi.fn(),
          applyContextLengthPreferenceFromResult: vi.fn(),
          setLocalTaskId: vi.fn(),
        },
        lock: {
          // Keeps task resolution deterministic while this test isolates pagination shaping.
          // Called by: the Vitest cases in this file through its owning hook, JSX prop, or analysis lifecycle config because the test needs a deterministic fixture, mock, or helper before exercising the behavior under assertion.
          resolveTaskId: vi.fn(() => Promise.resolve('task-1')),
          quotationSearch,
          detachQuotation: vi.fn(() =>
            Promise.resolve({
              state: 'running' as const,
              message: 'Quotation detach started',
              data: null,
              metadata: { task_id: 'quotation-detach-task' },
            }),
          ),
          materializeQuotation: vi.fn(() => Promise.resolve(undefined)),
        },
      }),
    );

    await act(async () => {
      await result.current.fetchQuotations('node-1');
    });

    const paginatedRequest = (quotationSearch.mock.calls[0] as unknown[] | undefined)?.[1] as
      | Record<string, unknown>
      | undefined;
    expect(paginatedRequest).toBeDefined();
    expect(paginatedRequest).toMatchObject({
      page_size: 50,
    });
  });
});
