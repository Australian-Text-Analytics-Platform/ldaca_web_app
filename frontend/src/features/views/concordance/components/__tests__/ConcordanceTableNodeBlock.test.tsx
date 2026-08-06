import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ConcordanceNodeResult } from '@/api';
import type { WorkspaceNodeMetadata } from '@/features/workspace/common/workspaceNodeMetadata';
import {
  ConcordanceTableNodeBlock,
  type ConcordanceTableNodeBlockProps,
} from '../ConcordanceTableNodeBlock';

const nodeData: ConcordanceNodeResult = {
  columns: ['CONC_left_context', 'CONC_matched_text', 'CONC_right_context', 'speaker'],
  data: [
    [
      {
        CONC_left_context: 'before',
        CONC_matched_text: 'alpha',
        CONC_right_context: 'after',
        speaker: 'A',
      },
    ],
  ],
  metadata: {
    concordance_columns: ['CONC_left_context', 'CONC_matched_text', 'CONC_right_context'],
    metadata_columns: ['speaker'],
    all_columns: ['CONC_left_context', 'CONC_matched_text', 'CONC_right_context', 'speaker'],
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
};

const buildProps = (handleSort: ConcordanceTableNodeBlockProps['handleSort']) =>
  ({
    nodeKey: 'node-1',
    nodeData,
    context: {
      nodeId: 'node-1',
      paginationKey: 'node-1',
      requestNodeId: 'node-1',
      column: 'text',
    },
    searchWord: 'alpha',
    showMetadata: true,
    selectedMetadataColumns: ['speaker'],
    selectedNodes: [],
    panelSelectedNodes: [{ id: 'node-1', name: 'Documents' } as WorkspaceNodeMetadata],
    effectiveNodeColumnSelections: [],
    sourceColorMap: {},
    defaultPalette: [],
    nodePagination: {},
    globalPageSize: 20,
    onPageSizeChange: vi.fn(),
    combinedPage: 1,
    combinedLoading: false,
    nodeLoading: {},
    handleSort,
    handlePageChange: vi.fn(),
    handleRowClick: vi.fn(),
    setCombinedPage: vi.fn(),
    openAddToWorkspaceDialog: vi.fn(),
  }) satisfies ConcordanceTableNodeBlockProps;

describe('ConcordanceTableNodeBlock', () => {
  it('keeps generated headers plain while source metadata remains sortable', () => {
    const handleSort = vi.fn();
    render(<ConcordanceTableNodeBlock {...buildProps(handleSort)} />);

    const generatedHeader = screen.getByRole('columnheader', { name: 'CONC_matched_text' });
    const metadataHeader = screen.getByRole('columnheader', { name: /^speaker/ });
    expect(generatedHeader).not.toHaveClass('cursor-pointer');
    expect(metadataHeader).toHaveClass('cursor-pointer');

    fireEvent.click(generatedHeader);
    expect(handleSort).not.toHaveBeenCalled();

    fireEvent.click(metadataHeader);
    expect(handleSort).toHaveBeenCalledWith('speaker', 'node-1', 'node-1');
  });

  it('keeps headers mounted and hides stale rows while a new page is processing', () => {
    const props = buildProps(vi.fn());
    render(<ConcordanceTableNodeBlock {...props} nodeLoading={{ 'node-1': true }} />);

    expect(screen.getByRole('columnheader', { name: 'CONC_matched_text' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Processing preview page' })).toBeInTheDocument();
    expect(screen.queryByText('alpha')).not.toBeInTheDocument();
  });
});
