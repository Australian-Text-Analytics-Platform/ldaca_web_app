import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Analysis } from '@/api';
import type { RunAnalysisOptions } from '../../../common/hooks/useAnalysisFeature';
import { useConcordanceTaskFlow } from '../useConcordanceTaskFlow';

const submitTabAnalysis = vi.hoisted(() => vi.fn());
vi.mock('@/api', async (importOriginal) => ({ ...(await importOriginal()), submitTabAnalysis }));

const executeAnalysis = async <TAnalysis extends Analysis>(
  options: RunAnalysisOptions<TAnalysis>,
) => {
  await options.prepare?.();
  const response = await options.submit();
  options.onSuccess?.(response);
  return response;
};

describe('useConcordanceTaskFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    submitTabAnalysis.mockResolvedValue({ data: { id: 'analysis-1', state: 'queued' } });
  });

  it('submits a canonical tab-owned concordance Analysis', async () => {
    const runAnalysis = vi.fn(executeAnalysis);
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
          runAnalysis,
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
    expect(runAnalysis).toHaveBeenCalledWith(expect.objectContaining({ action: 'preview' }));
  });
});
