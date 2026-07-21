import React from 'react';
import { render, screen } from '@testing-library/react';
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
  randomSeed: 0,
  onAddToWorkspace: vi.fn(),
  isAddingToWorkspace: false,
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

  it('offers the typed Add to Workspace action for successful results', () => {
    render(
      <TooltipProvider>
        <TopicModelingResultsPanel {...baseProps} />
      </TooltipProvider>,
    );

    expect(screen.getByText('Topic Modeling Results')).toBeInTheDocument();
    expect(screen.getByText('Topics (1)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add to Workspace' })).toBeInTheDocument();
  });
});
