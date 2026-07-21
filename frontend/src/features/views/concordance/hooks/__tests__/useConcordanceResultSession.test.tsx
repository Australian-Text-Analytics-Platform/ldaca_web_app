import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { projectWorkspaceNodeMetadata } from '@/features/workspace/common/workspaceNodeMetadata';
import type { ConcordanceAnalysisResponse } from '@/api';
import { useConcordanceResultSession } from '../useConcordanceResultSession';

const result: ConcordanceAnalysisResponse = {
  state: 'successful',
  metadata: { task_id: 'analysis-1' },
  analysis_params: {},
  query: { page: 1, page_size: 20 },
  data: {
    'node-1': {
      data: [[{ CONC_matched_text: 'Alpha' }, { CONC_matched_text: 'beta' }]],
      columns: ['CONC_matched_text'],
      metadata: {
        metadata_columns: [],
        concordance_columns: ['CONC_matched_text'],
        quotation_columns: [],
      },
      pagination: {
        page: 1,
        page_size: 20,
        total_source_rows: 1,
        total_source_pages: 1,
        result_count: 1,
        has_next: false,
        has_prev: false,
      },
      sorting: { sort_by: null, descending: false },
    },
  },
};

describe('useConcordanceResultSession', () => {
  it('projects the canonical analysis result into display colors and matched-text filters', () => {
    const { result: hook } = renderHook(() =>
      useConcordanceResultSession({
        selectedNodes: [projectWorkspaceNodeMetadata({ id: 'node-1', name: 'Corpus' })],
        showDispersion: true,
        colourMatches: true,
        lowercaseMatches: true,
      }),
    );

    act(() => hook.current.setResults(result));

    expect(hook.current.taskId).toBe('analysis-1');
    expect(hook.current.nodeColors['node-1']).toBe('#2563eb');
    expect(hook.current.sourceColorMap.corpus).toBe('#2563eb');
    expect(hook.current.allMatchedTexts).toEqual(['alpha', 'beta']);
  });

  it('clears result pagination and loading state when reset', () => {
    const { result: hook } = renderHook(() =>
      useConcordanceResultSession({
        selectedNodes: [],
        showDispersion: false,
        colourMatches: false,
        lowercaseMatches: false,
      }),
    );
    act(() => {
      hook.current.setNodePagination({
        'node-1': { currentPage: 2, pageSize: 20, sortBy: '', descending: false },
      });
      hook.current.setNodeLoading({ 'node-1': true });
      hook.current.reset();
    });
    expect(hook.current.results).toBeNull();
    expect(hook.current.nodePagination).toEqual({});
    expect(hook.current.nodeLoading).toEqual({});
  });
});
