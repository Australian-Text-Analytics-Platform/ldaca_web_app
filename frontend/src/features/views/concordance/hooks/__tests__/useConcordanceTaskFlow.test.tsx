import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useConcordanceTaskFlow } from '../useConcordanceTaskFlow';

const { runConcordanceMock } = vi.hoisted(() => ({
  runConcordanceMock: vi.fn(),
}));

vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal()),
  runConcordance: runConcordanceMock,
}));

describe('useConcordanceTaskFlow', () => {
  beforeEach(() => {
    runConcordanceMock.mockReset();
    runConcordanceMock.mockResolvedValue({
      data: { state: 'running', metadata: { task_id: 'concordance-task-1' } },
    });
  });

  it('submits a token handoff from its snapshot instead of stale rendered form state', async () => {
    const onTaskIdAssigned = vi.fn();
    const { result } = renderHook(() =>
      useConcordanceTaskFlow({
        state: {
          currentWorkspaceId: 'workspace-1',
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
          setViewMode: vi.fn(),
          setIsSearching: vi.fn(),
          setResults: vi.fn(),
          setLocalTaskId: vi.fn(),
          setNodeLoading: vi.fn(),
          setNodeDetaching: vi.fn(),
          setNodeMaterializing: vi.fn(),
          setMaterializeTaskIds: vi.fn(),
          onTaskIdAssigned,
        },
        lock: {
          resolveTaskId: vi.fn(() => Promise.resolve(null)),
          detachConcordance: vi.fn(),
          detachConcordanceDispersion: vi.fn(),
          materializeConcordance: vi.fn(),
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

    expect(runConcordanceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          node_ids: ['node-1'],
          node_columns: { 'node-1': 'text' },
          search_word: 'keyword',
        }),
      }),
    );
    expect(onTaskIdAssigned).toHaveBeenCalledWith('concordance-task-1');
  });
});
