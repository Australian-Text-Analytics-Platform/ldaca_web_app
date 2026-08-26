import type { CSSProperties, ReactNode } from 'react';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { WorkspaceNodeMetadata } from '@/features/workspace/common/workspaceNodeMetadata';
import { GREY, foregroundForVizColor } from '@/features/views/common/vizPalette';
import { CONCORDANCE_COMBINED_NODE_KEY } from '../../concordanceTableDomain';
import {
  ConcordanceDispersionNodeBlock,
  type ConcordanceDispersionNodeBlockProps,
} from '../ConcordanceDispersionNodeBlock';

vi.mock('@/features/views/common/components/AnalysisTableScrollArea', () => ({
  AnalysisTableFrame: ({
    children,
    belowTable,
    style,
  }: {
    children: ReactNode;
    belowTable?: ReactNode;
    style?: CSSProperties;
  }) => (
    <div data-testid="dispersion-table-card" style={style}>
      {children}
      {belowTable}
    </div>
  ),
}));

vi.mock('@/features/views/common/components/ServerPaginationFooter', () => ({
  ServerPaginationFooter: () => <div data-testid="dispersion-pagination" />,
}));

vi.mock('@/features/views/common/hooks/useServerTable', () => ({
  useServerTable: () => ({}),
}));

vi.mock('../ConcordanceDispersionRowsTable', () => ({
  ConcordanceDispersionRowsTable: ({
    getRowStyle,
    termColors,
  }: {
    getRowStyle?: (row: Record<string, unknown>, index: number) => CSSProperties | undefined;
    termColors?: Record<string, string>;
  }) => (
    <div
      data-testid="dispersion-rows"
      data-row-background={String(
        getRowStyle?.({ __source_node: 'Node 1' }, 0)?.backgroundColor ?? '',
      )}
      data-term-color={termColors?.alpha ?? ''}
    />
  ),
}));

vi.mock('../ConcordanceDispersionSummary', () => ({
  ConcordanceDispersionSummary: ({
    termColors,
    showChart,
  }: {
    termColors?: Record<string, string>;
    showChart?: boolean;
  }) => (
    <>
      <div data-testid="dispersion-match-controls" />
      {showChart === false ? null : (
        <div data-testid="dispersion-summary" data-term-color={termColors?.alpha ?? ''} />
      )}
    </>
  ),
}));

const nodeMetadata = (id: string, name: string, color: string): WorkspaceNodeMetadata => ({
  id,
  name,
  color,
  document: 'text',
  shape: [1, 1],
  tokenizerModel: null,
});

const nodeData = {
  data: [],
  columns: ['text'],
  metadata: {
    metadata_columns: [],
    concordance_columns: [],
    all_columns: ['text'],
  },
  pagination: {
    page: 1,
    page_size: 20,
    total_source_rows: 0,
    total_source_pages: 1,
    result_count: 0,
    has_prev: false,
    has_next: false,
  },
  sorting: { descending: false },
} as ConcordanceDispersionNodeBlockProps['nodeData'];

const baseProps: ConcordanceDispersionNodeBlockProps = {
  nodeKey: 'node-1',
  nodeData,
  context: {
    nodeId: 'node-1',
    paginationKey: 'node-1',
    requestNodeId: 'node-1',
    column: 'text',
    displayName: 'Node 1',
    nodeColor: '#2563eb',
  },
  searchWord: 'alpha',
  caseSensitive: false,
  showMetadata: false,
  selectedMetadataColumns: [],
  reviewRowUnit: 'documents',
  densitySeries: [{ label: 'alpha', counts: Array.from({ length: 100 }, () => 0) }],
  interactiveFilters: false,
  excludedMatchedTexts: new Set<string>(),
  uncasedMatchedTexts: false,
  onUncasedMatchedTextsChange: vi.fn(),
  onToggleMatchedTexts: vi.fn(),
  termColors: { alpha: '#123456' },
  resultsViewportWidth: 800,
  panelSelectedNodes: [nodeMetadata('node-1', 'Node 1', '#2563eb')],
  effectiveNodeColumnSelections: [{ nodeId: 'node-1', column: 'text' }],
  sourceColorMap: { 'node-1': '#2563eb' },
  defaultPalette: ['#2563eb', '#dc2626'],
  nodePagination: {},
  globalPageSize: 20,
  onPageSizeChange: vi.fn(),
  combinedPage: 1,
  combinedLoading: false,
  nodeLoading: {},
  proportionalDispersionBars: false,
  binCount: 20,
  onBinCountChange: vi.fn(),
  dispersionChartMode: 'density-line',
  onDispersionChartModeChange: vi.fn(),
  selectedBinIndices: {},
  onBinSelect: vi.fn(),
  onBinRangeSelect: vi.fn(),
  onClearBinSelection: vi.fn(),
  handlePageChange: vi.fn(),
  setCombinedPage: vi.fn(),
};

describe('ConcordanceDispersionNodeBlock', () => {
  it('uses one saturated source header above neutral table and plot cards', () => {
    const longName = 'qldelection2020_candidate_tweets_filtered_by_username_in_AnnastaciaMP';
    render(
      <ConcordanceDispersionNodeBlock
        {...baseProps}
        context={{ ...baseProps.context, displayName: longName }}
      />,
    );

    const card = screen.getByTestId('concordance-dispersion-source-card');
    const header = within(card).getByTestId('concordance-dispersion-source-header');
    expect(header).toHaveStyle({
      backgroundColor: '#2563eb',
      color: foregroundForVizColor('#2563eb'),
    });
    expect(within(header).getByTitle(longName)).toBeInTheDocument();
    expect(within(card).getByTestId('dispersion-table-card').style.borderLeftWidth).toBe('');
    const table = within(card).getByTestId('dispersion-table-card');
    const controls = within(card).getByTestId('dispersion-match-controls');
    const plot = within(card).getByTestId('dispersion-summary');
    expect(table.compareDocumentPosition(controls) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(controls.compareDocumentPosition(plot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(card).getByTestId('dispersion-summary')).toHaveAttribute(
      'data-term-color',
      '#123456',
    );
    expect(within(card).getByTestId('dispersion-rows')).toHaveAttribute(
      'data-term-color',
      '#123456',
    );
  });

  it('falls back to the established neutral color for invalid source metadata', () => {
    render(
      <ConcordanceDispersionNodeBlock
        {...baseProps}
        context={{ ...baseProps.context, nodeColor: 'not-a-color' }}
      />,
    );

    expect(screen.getByTestId('concordance-dispersion-source-header')).toHaveStyle({
      backgroundColor: GREY,
      color: foregroundForVizColor(GREY),
    });
  });

  it('retains the shared match controls when proportional bars hide the plot', () => {
    render(<ConcordanceDispersionNodeBlock {...baseProps} proportionalDispersionBars />);

    expect(screen.getByTestId('dispersion-match-controls')).toBeInTheDocument();
    expect(screen.queryByTestId('dispersion-summary')).not.toBeInTheDocument();
  });

  it('uses a neutral combined header with colored source chips and source-tinted rows', () => {
    render(
      <ConcordanceDispersionNodeBlock
        {...baseProps}
        nodeKey={CONCORDANCE_COMBINED_NODE_KEY}
        context={{
          nodeId: '',
          paginationKey: CONCORDANCE_COMBINED_NODE_KEY,
          requestNodeId: CONCORDANCE_COMBINED_NODE_KEY,
          column: 'text',
        }}
        panelSelectedNodes={[
          nodeMetadata('node-1', 'Node 1', '#2563eb'),
          nodeMetadata('node-2', 'Node 2', '#dc2626'),
        ]}
        effectiveNodeColumnSelections={[
          { nodeId: 'node-1', column: 'text' },
          { nodeId: 'node-2', column: 'text' },
        ]}
        sourceColorMap={{
          'node-1': '#2563eb',
          'node 1': '#2563eb',
          'node-2': '#dc2626',
          'node 2': '#dc2626',
        }}
      />,
    );

    const header = screen.getByTestId('concordance-dispersion-combined-header');
    expect(header.style.backgroundColor).toBe('');
    expect(within(header).getByText('Combined Results')).toBeInTheDocument();
    expect(within(header).getByTestId('concordance-source-chip-node-1')).toHaveStyle({
      backgroundColor: '#2563eb',
      color: foregroundForVizColor('#2563eb'),
    });
    expect(within(header).getByTestId('concordance-source-chip-node-2')).toHaveStyle({
      backgroundColor: '#dc2626',
      color: foregroundForVizColor('#dc2626'),
    });
    expect(screen.getByTestId('dispersion-rows')).toHaveAttribute(
      'data-row-background',
      '#2563eb20',
    );
  });
});
