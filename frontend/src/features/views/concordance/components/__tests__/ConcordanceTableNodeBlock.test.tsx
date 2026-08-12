import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { ConcordanceNodeResult } from '@/api';
import type { WorkspaceNodeMetadata } from '@/features/workspace/common/workspaceNodeMetadata';
import { toBgColor } from '@/features/views/common/vizPalette';
import {
  ConcordanceTableNodeBlock,
  type ConcordanceTableNodeBlockProps,
} from '../ConcordanceTableNodeBlock';
import { CONCORDANCE_COMBINED_NODE_KEY } from '../../concordanceTableDomain';

const nodeData: ConcordanceNodeResult = {
  columns: [
    'CONC_left_context',
    'CONC_matched_text',
    'CONC_right_context',
    'CONC_start_idx',
    'CONC_end_idx',
    'CONC_l1',
    'CONC_r1',
    'CONC_l1_freq',
    'CONC_r1_freq',
    'speaker',
  ],
  data: [
    [
      {
        CONC_left_context: 'before',
        CONC_matched_text: 'alpha',
        CONC_right_context: 'after',
        CONC_start_idx: 7,
        CONC_end_idx: 12,
        CONC_l1: 'before',
        CONC_r1: 'after',
        CONC_l1_freq: 2,
        CONC_r1_freq: 3,
        speaker: 'A',
      },
    ],
  ],
  metadata: {
    concordance_columns: [
      'CONC_left_context',
      'CONC_matched_text',
      'CONC_right_context',
      'CONC_start_idx',
      'CONC_end_idx',
      'CONC_l1',
      'CONC_r1',
      'CONC_l1_freq',
      'CONC_r1_freq',
    ],
    metadata_columns: ['speaker'],
    all_columns: [
      'CONC_left_context',
      'CONC_matched_text',
      'CONC_right_context',
      'CONC_start_idx',
      'CONC_end_idx',
      'CONC_l1',
      'CONC_r1',
      'CONC_l1_freq',
      'CONC_r1_freq',
      'speaker',
    ],
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
      nodeColor: '#2563eb',
    },
    searchWord: 'alpha',
    showMetadata: true,
    selectedMetadataColumns: ['speaker'],
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
    reviewRowUnit: null,
    highlightL1R1: true,
    handleSort,
    handlePageChange: vi.fn(),
    handleRowClick: vi.fn(),
    setCombinedPage: vi.fn(),
  }) satisfies ConcordanceTableNodeBlockProps;

describe('ConcordanceTableNodeBlock', () => {
  it('keeps generated Preview headers plain with a Run All hint while metadata sorts', async () => {
    const user = userEvent.setup();
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

    await user.hover(screen.getByText('CONC_matched_text'));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Run All to enable sorting');
  });

  it('sorts generated scalar columns in separated Review but not full contexts', () => {
    const handleSort = vi.fn();
    render(<ConcordanceTableNodeBlock {...buildProps(handleSort)} reviewRowUnit="matches" />);

    fireEvent.click(screen.getByRole('columnheader', { name: 'CONC_l1▲▼' }));
    fireEvent.click(screen.getByRole('columnheader', { name: 'CONC_start_idx▲▼' }));
    fireEvent.click(screen.getByRole('columnheader', { name: 'CONC_left_context' }));

    expect(handleSort).toHaveBeenNthCalledWith(1, 'CONC_l1', 'node-1', 'node-1');
    expect(handleSort).toHaveBeenNthCalledWith(2, 'CONC_start_idx', 'node-1', 'node-1');
    expect(handleSort).toHaveBeenCalledTimes(2);
  });

  it('tints direct L1/R1 cells and keeps matched text emphasized when toggled off', () => {
    const { rerender } = render(<ConcordanceTableNodeBlock {...buildProps(vi.fn())} />);

    expect(screen.getAllByText('before', { selector: 'td' })[1]).toHaveStyle({
      backgroundColor: toBgColor('#2563eb', 0.12),
    });
    expect(screen.getByText('alpha', { selector: 'td' })).toHaveStyle({
      backgroundColor: toBgColor('#2563eb', 0.24),
    });

    rerender(<ConcordanceTableNodeBlock {...buildProps(vi.fn())} highlightL1R1={false} />);

    expect(screen.getAllByText('before', { selector: 'td' })[1]).not.toHaveStyle({
      backgroundColor: toBgColor('#2563eb', 0.12),
    });
    expect(screen.getByText('alpha', { selector: 'td' })).toHaveClass('font-semibold');
  });

  it('uses the palette fallback for highlighted cells in combined tables', () => {
    const combinedData: ConcordanceNodeResult = {
      ...nodeData,
      data: [[{ ...nodeData.data[0]![0]!, __source_node: 'unknown source' }]],
    };
    render(
      <ConcordanceTableNodeBlock
        {...buildProps(vi.fn())}
        nodeKey={CONCORDANCE_COMBINED_NODE_KEY}
        nodeData={combinedData}
        defaultPalette={['#dc2626']}
      />,
    );

    expect(screen.getByText('alpha', { selector: 'td' })).toHaveStyle({
      backgroundColor: toBgColor('#dc2626', 0.24),
    });
    expect(
      screen
        .getAllByRole('columnheader')
        .every((header) => !header.classList.contains('cursor-pointer')),
    ).toBe(true);
  });

  it('keeps headers mounted and hides stale rows while a new page is processing', () => {
    const props = buildProps(vi.fn());
    render(<ConcordanceTableNodeBlock {...props} nodeLoading={{ 'node-1': true }} />);

    expect(screen.getByRole('columnheader', { name: 'CONC_matched_text' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Processing preview page' })).toBeInTheDocument();
    expect(screen.queryByText('alpha')).not.toBeInTheDocument();
  });
});
