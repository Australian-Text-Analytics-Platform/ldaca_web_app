import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Analysis } from '@/api';
import { useQuotationTaskFlow } from '../useQuotationTaskFlow';

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
    const quotationSearch = vi.fn(async () => queuedQuotationAnalysis());
    const onTaskIdAssigned = vi.fn();
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
          showErrorDialog: vi.fn(),
          updateResultState: vi.fn(),
          applyContextLengthPreferenceFromResult: vi.fn(),
          setLocalTaskId: vi.fn(),
          runningRef: { current: false },
          lastFetchedRef: { current: { taskId: null, state: null } },
          onTaskIdAssigned,
        },
        lock: {
          resolveTaskId: vi.fn(async () => null),
          quotationSearch,
          detachQuotation: vi.fn(),
        },
      }),
    );
    await act(async () => result.current.fetchQuotations('node-1'));
    expect(quotationSearch).toHaveBeenCalledWith('node-1', {
      node_id: 'node-1',
      column: 'text',
      engine: { type: 'local' },
    });
    expect(onTaskIdAssigned).toHaveBeenCalledWith('analysis-1');
  });

  it('does not mark quotation results loaded when the background submission is only queued', async () => {
    const setHasLoaded = vi.fn();
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
          setHasLoaded,
          setNodeDetaching: vi.fn(),
          showErrorDialog: vi.fn(),
          updateResultState: vi.fn(),
          applyContextLengthPreferenceFromResult: vi.fn(),
          setLocalTaskId: vi.fn(),
          runningRef: { current: false },
          lastFetchedRef: { current: { taskId: null, state: null } },
          onTaskIdAssigned: vi.fn(),
        },
        lock: {
          resolveTaskId: vi.fn(async () => null),
          quotationSearch: vi.fn(async () => queuedQuotationAnalysis()),
          detachQuotation: vi.fn(),
        },
      }),
    );

    await act(async () => result.current.handleSearchAll());

    expect(setHasLoaded).not.toHaveBeenCalledWith(true);
  });
});
