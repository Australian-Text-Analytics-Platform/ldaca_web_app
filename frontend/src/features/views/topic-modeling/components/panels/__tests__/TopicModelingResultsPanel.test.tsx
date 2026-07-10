import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';

import { TopicModelingResultsPanel } from '../TopicModelingResultsPanel';

vi.mock('../results/TopicModelingBubbleChartSection', () => ({
  TopicModelingBubbleChartSection: ({ controlRowSlot }: { controlRowSlot?: React.ReactNode }) => (
    <div data-testid="topic-bubble-chart-section">{controlRowSlot}</div>
  ),
}));

vi.mock('../../../common/components/AnalysisCardLayout', () => ({
  AnalysisCardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('../../../common/components/AnalysisRunningStateCard', () => ({
  AnalysisRunningStateCard: () => <div data-testid="analysis-running-state" />,
}));

const baseProps = {
  topicWaitingBanner: null,
  runningTask: null,
  result: {
    state: 'successful' as const,
    message: 'Topics ready',
    data: {
      topics: [
        {
          id: 1,
          label: 'alpha beta',
          size: [4],
          total_size: 4,
          x: 0,
          y: 0,
        },
      ],
      corpus_sizes: [4],
      meta: {},
    },
  },
  error: null,
  topics: [
    {
      id: 1,
      label: 'alpha beta',
      size: [4],
      total_size: 4,
      x: 0,
      y: 0,
    },
  ],
  containerRef: { current: null },
  isDetachLoading: false,
  isDetaching: false,
  openDetachDialog: vi.fn(),
  chartRef: { current: null },
  handleResetZoom: vi.fn(),
  isAtGlobalZoom: true,
  bubbleElements: <svg />,
  tooltip: { topic: null, x: 0, y: 0 },
  renderSizeComposition: vi.fn(() => null),
  hoveredTopicId: null,
  setHoveredTopicId: vi.fn(),
  selectedTopicIds: new Set<number>(),
  onToggleTopicSelection: vi.fn(),
  onClearSelection: vi.fn(),
  topicSearchQuery: '',
  onTopicSearchQueryChange: vi.fn(),
  activeDomain: null,
  nodeNames: ['Corpus A'],
  topicSizeValue: 10,
  randomSeed: 42,
  detachDialogOpen: false,
  setDetachDialogOpen: vi.fn(),
  detachNodeOptions: [],
  selectedDetachColumns: {},
  toggleDetachColumn: vi.fn(),
  selectAllDetachColumns: vi.fn(),
  deselectAllDetachColumns: vi.fn(),
  handleDetachConfirm: vi.fn(),
};

describe('TopicModelingResultsPanel', () => {
  it('renders successful results without the removed exact-topic-count slider', () => {
    render(
      <TooltipProvider>
        <TopicModelingResultsPanel {...baseProps} />
      </TooltipProvider>,
    );

    // The post-fit re-aggregation slider was removed along with target/exact
    // topic-count modes; only the native min-cluster-size control remains.
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    expect(screen.getByText('Topics (1)')).toBeInTheDocument();
  });

  it('owns the topic detach dialog copy and handler wiring directly', async () => {
    const user = userEvent.setup();
    const toggleDetachColumn = vi.fn();
    const handleDetachConfirm = vi.fn();
    render(
      <TooltipProvider>
        <TopicModelingResultsPanel
          {...baseProps}
          detachDialogOpen
          detachNodeOptions={[
            {
              node_id: 'node-1',
              node_name: 'Corpus A',
              available_columns: ['TOPIC_topic', 'document'],
            },
          ]}
          selectedDetachColumns={{ 'node-1': ['TOPIC_topic'] }}
          toggleDetachColumn={toggleDetachColumn}
          handleDetachConfirm={handleDetachConfirm}
        />
      </TooltipProvider>,
    );

    expect(screen.getByRole('heading', { name: 'Detach Topic Results' })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Select the columns to include with the detached topic results. The topic columns are selected by default; untick any you don't need.",
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'document' }));
    expect(toggleDetachColumn).toHaveBeenCalledWith('node-1', 'document', true);

    await user.click(screen.getByRole('button', { name: 'Add to Workspace' }));
    expect(handleDetachConfirm).toHaveBeenCalledOnce();
  });
});
