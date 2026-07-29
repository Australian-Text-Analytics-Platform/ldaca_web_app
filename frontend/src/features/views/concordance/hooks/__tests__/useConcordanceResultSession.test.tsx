import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { projectWorkspaceNodeMetadata } from '@/features/workspace/common/workspaceNodeMetadata';
import type { ConcordanceAnalysisResponse } from '@/api';
import { useConcordanceResultSession } from '../useConcordanceResultSession';

const result: ConcordanceAnalysisResponse = {
  kind: 'concordance',
  sources: [],
  metadata: {
    metadata_columns: [],
    concordance_columns: ['CONC_matched_text'],
    quotation_columns: [],
    all_columns: ['CONC_matched_text'],
  },
  query: { page: 1, page_size: 20 },
  data: {
    'node-1': {
      data: [[{ CONC_matched_text: 'Alpha' }, { CONC_matched_text: 'beta' }]],
      columns: ['CONC_matched_text'],
      metadata: {
        metadata_columns: [],
        concordance_columns: ['CONC_matched_text'],
        quotation_columns: [],
        all_columns: ['CONC_matched_text'],
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

const createWrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
};

describe('useConcordanceResultSession', () => {
  it('projects the canonical analysis result into Data Block display colors', () => {
    const { result: hook } = renderHook(
      () =>
        useConcordanceResultSession({
          workspaceId: 'workspace-1',
          analysisId: 'analysis-1',
          baseResult: result,
          viewMode: 'separated',
          combinedPage: 1,
          selectedNodes: [projectWorkspaceNodeMetadata({ id: 'node-1', name: 'Corpus' })],
          showDispersion: true,
          reviewDispersionRowUnit: 'documents',
        }),
      { wrapper: createWrapper() },
    );

    expect(hook.current.nodeColors['node-1']).toBe('#2563eb');
    expect(hook.current.sourceColorMap.corpus).toBe('#2563eb');
  });

  it('clears result pagination and loading state when reset', () => {
    const { result: hook } = renderHook(
      () =>
        useConcordanceResultSession({
          workspaceId: null,
          analysisId: null,
          baseResult: null,
          viewMode: 'separated',
          combinedPage: 1,
          selectedNodes: [],
          showDispersion: false,
          reviewDispersionRowUnit: 'documents',
        }),
      { wrapper: createWrapper() },
    );
    act(() => {
      hook.current.setNodePagination({
        'node-1': { currentPage: 2, pageSize: 20, sortBy: '', descending: false },
      });
      hook.current.reset();
    });
    expect(hook.current.results).toBeNull();
    expect(hook.current.nodePagination).toEqual({});
    expect(hook.current.nodeLoading).toEqual({});
  });
});
