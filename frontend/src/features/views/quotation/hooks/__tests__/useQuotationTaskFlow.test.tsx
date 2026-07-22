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
  integrity: { status: 'valid' },
  parent_analysis_id: null,
  progress: { fraction: null, message: null },
  request: {
    kind: 'quotation',
    node_id: 'node-1',
    column: 'text',
    engine: { type: 'local' },
  },
  revision: 1,
  started_at: null,
  state: 'queued',
});

describe('useQuotationTaskFlow', () => {
  it('submits the typed quotation request through the tab-owned analysis action', async () => {
    submitTabAnalysis.mockResolvedValueOnce({ data: queuedQuotationAnalysis() });
    const onTaskIdAssigned = vi.fn();
    const { result } = renderHook(() =>
      useQuotationTaskFlow({
        state: {
          currentWorkspaceId: 'workspace-1',
          tabId: 'tab-1',
          hasLoaded: false,
          displayedNodes: [{ id: 'node-1', name: 'Node 1' }],
          activeSelections: [{ nodeId: 'node-1', column: 'text' }],
          nodeState: {},
          originalColumnsByNode: { 'node-1': ['text'] },
          buildEngineRequest: () => ({ type: 'local' }),
        },
        actions: {
          setIsLoadingQuotations: vi.fn(),
          setNodeDetaching: vi.fn(),
          showErrorDialog: vi.fn(),
          setResultQuery: vi.fn(),
          resetResultQuery: vi.fn(),
          setLocalTaskId: vi.fn(),
          runningRef: { current: false },
          lastFetchedRef: { current: { taskId: null, state: null } },
          onTaskIdAssigned,
        },
        lock: {
          resolveTaskId: vi.fn(async () => null),
          detachQuotation: vi.fn(),
        },
      }),
    );
    await act(async () => result.current.fetchQuotations('node-1'));
    expect(submitTabAnalysis).toHaveBeenCalledWith({
      body: {
        kind: 'quotation',
        node_id: 'node-1',
        column: 'text',
        engine: { type: 'local' },
      },
      path: { workspace_id: 'workspace-1', tab_id: 'tab-1' },
      throwOnError: true,
    });
    expect(onTaskIdAssigned).toHaveBeenCalledWith('analysis-1');
  });

  it('does not synthesize a Result while the submitted Analysis is queued', async () => {
    submitTabAnalysis.mockResolvedValueOnce({ data: queuedQuotationAnalysis() });
    const setResultQuery = vi.fn();
    const resetResultQuery = vi.fn();
    const { result } = renderHook(() =>
      useQuotationTaskFlow({
        state: {
          currentWorkspaceId: 'workspace-1',
          tabId: 'tab-1',
          hasLoaded: false,
          displayedNodes: [{ id: 'node-1', name: 'Node 1' }],
          activeSelections: [{ nodeId: 'node-1', column: 'text' }],
          nodeState: {},
          originalColumnsByNode: { 'node-1': ['text'] },
          buildEngineRequest: () => ({ type: 'local' }),
        },
        actions: {
          setIsLoadingQuotations: vi.fn(),
          setNodeDetaching: vi.fn(),
          showErrorDialog: vi.fn(),
          setResultQuery,
          resetResultQuery,
          setLocalTaskId: vi.fn(),
          runningRef: { current: false },
          lastFetchedRef: { current: { taskId: null, state: null } },
          onTaskIdAssigned: vi.fn(),
        },
        lock: {
          resolveTaskId: vi.fn(async () => null),
          detachQuotation: vi.fn(),
        },
      }),
    );

    await act(async () => result.current.handleSearchAll());

    expect(resetResultQuery).toHaveBeenCalledOnce();
    expect(setResultQuery).not.toHaveBeenCalled();
  });

  it('sorts by the selected source column before schema options finish hydrating', async () => {
    const setResultQuery = vi.fn();
    const { result } = renderHook(() =>
      useQuotationTaskFlow({
        state: {
          currentWorkspaceId: 'workspace-1',
          tabId: 'tab-1',
          hasLoaded: true,
          displayedNodes: [{ id: 'node-1', name: 'Node 1' }],
          activeSelections: [{ nodeId: 'node-1', column: 'text' }],
          nodeState: {
            'node-1': {
              currentPage: 1,
              pageSize: 100,
              sortBy: undefined,
              descending: false,
            },
          },
          originalColumnsByNode: { 'node-1': [] },
          buildEngineRequest: () => ({ type: 'local' }),
        },
        actions: {
          setIsLoadingQuotations: vi.fn(),
          setNodeDetaching: vi.fn(),
          showErrorDialog: vi.fn(),
          setResultQuery,
          resetResultQuery: vi.fn(),
          setLocalTaskId: vi.fn(),
          runningRef: { current: false },
          lastFetchedRef: { current: { taskId: 'analysis-1', state: 'succeeded' } },
          onTaskIdAssigned: vi.fn(),
        },
        lock: {
          resolveTaskId: vi.fn(async () => 'analysis-1'),
          detachQuotation: vi.fn(),
        },
      }),
    );

    await act(async () => result.current.handleSort('node-1', 'text'));

    expect(setResultQuery).toHaveBeenCalledWith({
      page: 1,
      page_size: 100,
      sort_by: 'text',
      descending: false,
    });
  });
});
