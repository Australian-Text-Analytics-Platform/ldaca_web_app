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

  it('submits a canonical tab-owned concordance Analysis', async () => {
    const onSubmitted = vi.fn();
    const setIsSearching = vi.fn();
    const { result } = renderHook(() =>
      useConcordanceTaskFlow({
        state: {
          currentWorkspaceId: 'workspace-1',
          tabId: 'tab-1',
          searchWord: 'keyword',
          activeNodeIds: ['node-1'],
          effectiveNodeColumnSelections: [{ nodeId: 'node-1', column: 'text' }],
          globalPageSize: 20,
          nodePagination: {},
          viewMode: 'separated',
          combinedPage: 1,
          numLeftTokens: 5,
          numRightTokens: 5,
          regex: false,
          wholeWord: true,
          caseSensitive: false,
          ignorePunctuation: true,
          searchMode: 'tokens',
          tokenizerModelsByNode: { 'node-1': 'native:plain_words_en' },
          supersedesAnalysisIds: [],
        },
        actions: {
          setNodePagination: vi.fn(),
          setIsSearching,
          setLocalTaskId: vi.fn(),
          runningRef: { current: false },
          onSubmitted,
        },
      }),
    );

    await act(async () => {
      await result.current.handleSearch();
    });

    expect(submitTabAnalysis).toHaveBeenCalledWith({
      body: expect.objectContaining({
        execution_scope: 'preview',
        request: expect.objectContaining({
          kind: 'concordance',
          node_ids: ['node-1'],
          node_columns: { 'node-1': 'text' },
          node_tokenizer_models: { 'node-1': 'native:plain_words_en' },
          search_word: 'keyword',
          search_mode: 'tokens',
          ignore_punctuation: true,
        }),
      }),
      path: { workspace_id: 'workspace-1', tab_id: 'tab-1' },
      throwOnError: true,
    });
    expect(onSubmitted).toHaveBeenCalledOnce();
    expect(setIsSearching).toHaveBeenCalledTimes(1);
    expect(setIsSearching).toHaveBeenCalledWith(true);
  });
});
