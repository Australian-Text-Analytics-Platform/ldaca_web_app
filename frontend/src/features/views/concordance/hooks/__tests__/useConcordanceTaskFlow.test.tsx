import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useConcordanceTaskFlow } from '../useConcordanceTaskFlow';

const submitTabAnalysis = vi.hoisted(() => vi.fn());
vi.mock('@/api', async (importOriginal) => ({ ...(await importOriginal()), submitTabAnalysis }));

describe('useConcordanceTaskFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    submitTabAnalysis.mockResolvedValue({ data: { id: 'analysis-1', state: 'queued' } });
  });

  it('submits a token handoff as a canonical tab-owned analysis', async () => {
    const onTaskIdAssigned = vi.fn();
    const setIsSearching = vi.fn();
    const { result } = renderHook(() =>
      useConcordanceTaskFlow({
        state: {
          currentWorkspaceId: 'workspace-1',
          tabId: 'tab-1',
          searchWord: '',
          activeNodeIds: [],
          effectiveNodeColumnSelections: [],
          globalPageSize: 20,
          nodePagination: {},
          viewMode: 'separated',
          combinedPage: 1,
          numLeftTokens: 5,
          numRightTokens: 5,
          regex: false,
          wholeWord: true,
          caseSensitive: false,
          searchMode: 'tokens',
        },
        actions: {
          setNodePagination: vi.fn(),
          setIsSearching,
          setResults: vi.fn(),
          setLocalTaskId: vi.fn(),
          runningRef: { current: false },
          lastFetchedRef: { current: { taskId: null, state: null } },
          setNodeLoading: vi.fn(),
          setNodeDetaching: vi.fn(),
          onTaskIdAssigned,
        },
        lock: {
          resolveTaskId: vi.fn(async () => null),
          detachConcordance: vi.fn(),
          detachConcordanceDispersion: vi.fn(),
        },
      }),
    );

    await act(async () => {
      await result.current.handleHandoffSearch({
        searchWord: 'keyword',
        nodeIds: ['node-1'],
        nodeColumnSelections: [{ nodeId: 'node-1', column: 'text' }],
      });
    });

    expect(submitTabAnalysis).toHaveBeenCalledWith({
      body: expect.objectContaining({
        kind: 'concordance',
        node_ids: ['node-1'],
        node_columns: { 'node-1': 'text' },
        search_word: 'keyword',
      }),
      path: { workspace_id: 'workspace-1', tab_id: 'tab-1' },
      throwOnError: true,
    });
    expect(onTaskIdAssigned).toHaveBeenCalledWith('analysis-1');
    expect(setIsSearching).toHaveBeenCalledTimes(1);
    expect(setIsSearching).toHaveBeenCalledWith(true);
  });
});
