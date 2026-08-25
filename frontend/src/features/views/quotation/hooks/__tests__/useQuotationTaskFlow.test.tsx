import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Analysis } from '@/api';
import { useQuotationTaskFlow } from '../useQuotationTaskFlow';

const submitTabAnalysis = vi.hoisted(() => vi.fn());
vi.mock('@/api', async (importOriginal) => ({ ...(await importOriginal()), submitTabAnalysis }));

const queuedQuotationAnalysis = (): Analysis => ({
  cancellation_requested_at: null,
  created_at: '2026-07-20T00:00:00Z',
  error: null,
  finished_at: null,
  id: 'analysis-1',
  tab_id: 'tab-1',
  integrity: { status: 'valid' },
  parent_analysis_id: null,
  execution_scope: 'preview',
  supersedes_analysis_ids: [],
  progress: { fraction: null, message: null },
  request: {
    kind: 'quotation',
    node_id: 'node-1',
    column: 'text',
    engine: { type: 'local' },
  },
  revision: 1,
  output_node_ids: [],
  started_at: null,
  state: 'queued',
});

describe('useQuotationTaskFlow', () => {
  it('submits the typed quotation request through the tab-owned analysis action', async () => {
    submitTabAnalysis.mockResolvedValueOnce({ data: queuedQuotationAnalysis() });
    const onSubmitted = vi.fn();
    const { result } = renderHook(() =>
      useQuotationTaskFlow({
        state: {
          currentWorkspaceId: 'workspace-1',
          tabId: 'tab-1',
          hasLoaded: false,
          displayedNodes: [{ id: 'node-1', name: 'Node 1' }],
          activeSelections: [{ nodeId: 'node-1', column: 'text' }],
          previewRequest: { page: 1, page_size: 50, sort_by: null, descending: false },
          originalColumnsByNode: { 'node-1': ['text'] },
          buildEngineRequest: () => ({ type: 'local' }),
          supersedesAnalysisIds: [],
        },
        actions: {
          setIsLoadingQuotations: vi.fn(),
          showErrorDialog: vi.fn(),
          setPreviewRequest: vi.fn(),
          resetPreviewRequest: vi.fn(),
          setLocalTaskId: vi.fn(),
          runningRef: { current: false },
          onSubmitted,
        },
      }),
    );
    await act(async () => result.current.fetchQuotations('node-1'));
    expect(submitTabAnalysis).toHaveBeenCalledWith({
      body: {
        execution_scope: 'preview',
        request: {
          kind: 'quotation',
          node_id: 'node-1',
          column: 'text',
          engine: { type: 'local' },
        },
      },
      path: { workspace_id: 'workspace-1', tab_id: 'tab-1' },
      throwOnError: true,
    });
    expect(onSubmitted).toHaveBeenCalledOnce();
  });

  it('does not synthesize a Result while the submitted Analysis is queued', async () => {
    submitTabAnalysis.mockResolvedValueOnce({ data: queuedQuotationAnalysis() });
    const setPreviewRequest = vi.fn();
    const resetPreviewRequest = vi.fn();
    const { result } = renderHook(() =>
      useQuotationTaskFlow({
        state: {
          currentWorkspaceId: 'workspace-1',
          tabId: 'tab-1',
          hasLoaded: false,
          displayedNodes: [{ id: 'node-1', name: 'Node 1' }],
          activeSelections: [{ nodeId: 'node-1', column: 'text' }],
          previewRequest: { page: 1, page_size: 50, sort_by: null, descending: false },
          originalColumnsByNode: { 'node-1': ['text'] },
          buildEngineRequest: () => ({ type: 'local' }),
          supersedesAnalysisIds: [],
        },
        actions: {
          setIsLoadingQuotations: vi.fn(),
          showErrorDialog: vi.fn(),
          setPreviewRequest,
          resetPreviewRequest,
          setLocalTaskId: vi.fn(),
          runningRef: { current: false },
          onSubmitted: vi.fn(),
        },
      }),
    );

    await act(async () => result.current.handleSearchAll());

    expect(resetPreviewRequest).toHaveBeenCalledOnce();
    expect(setPreviewRequest).not.toHaveBeenCalled();
  });

  it('sorts by the selected source column before schema options finish hydrating', async () => {
    const setPreviewRequest = vi.fn();
    const { result } = renderHook(() =>
      useQuotationTaskFlow({
        state: {
          currentWorkspaceId: 'workspace-1',
          tabId: 'tab-1',
          hasLoaded: true,
          displayedNodes: [{ id: 'node-1', name: 'Node 1' }],
          activeSelections: [{ nodeId: 'node-1', column: 'text' }],
          previewRequest: { page: 1, page_size: 100, sort_by: null, descending: false },
          originalColumnsByNode: { 'node-1': [] },
          buildEngineRequest: () => ({ type: 'local' }),
          supersedesAnalysisIds: [],
        },
        actions: {
          setIsLoadingQuotations: vi.fn(),
          showErrorDialog: vi.fn(),
          setPreviewRequest,
          resetPreviewRequest: vi.fn(),
          setLocalTaskId: vi.fn(),
          runningRef: { current: false },
          onSubmitted: vi.fn(),
        },
      }),
    );

    await act(async () => result.current.handleSort('node-1', 'text'));

    expect(setPreviewRequest).toHaveBeenCalledWith({
      page: 1,
      page_size: 100,
      sort_by: 'text',
      descending: false,
    });
  });
});
