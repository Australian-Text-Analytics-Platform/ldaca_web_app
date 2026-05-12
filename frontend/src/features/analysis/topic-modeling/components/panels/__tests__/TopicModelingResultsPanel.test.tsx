import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';

import { TopicModelingResultsPanel } from '../TopicModelingResultsPanel';

vi.mock('../results/TopicModelingBubbleChartSection', () => ({
  TopicModelingBubbleChartSection: () => <div data-testid="topic-bubble-chart-section" />,
}));

vi.mock('../results/TopicModelingDetachDialog', () => ({
  TopicModelingDetachDialog: () => null,
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
    state: 'successful',
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
      meta: { raw_total_topics: 12 },
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
  topicSizeMode: 'exact',
  topicSizeValue: 5,
  currentExactTopicCount: 5,
  randomSeed: 42,
  exactTopicCountRange: { min: 2, max: 12 },
  isUpdatingExactTopicCount: false,
  onUpdateExactTopicCount: vi.fn(),
  detachDialogOpen: false,
  setDetachDialogOpen: vi.fn(),
  detachNodeOptions: [],
  selectedDetachColumns: {},
  toggleDetachColumn: vi.fn(),
  selectAllDetachColumns: vi.fn(),
  deselectAllDetachColumns: vi.fn(),
  handleDetachConfirm: vi.fn(),
  stopwordFilterAvailable: false,
  stopwordFilterEnabled: false,
  onStopwordFilterToggle: vi.fn(),
};

describe('TopicModelingResultsPanel', () => {
  it('shows the post-run exact topic count control for successful exact results', () => {
    render(
      <TooltipProvider>
        <TopicModelingResultsPanel {...baseProps} />
      </TooltipProvider>
    );

    expect(screen.getByRole('slider', { name: 'Exact Topic No. after modelling' })).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.queryByText('Range 2-12 from the raw fit')).not.toBeInTheDocument();
  });

  it('shows the live exact topic count in a tooltip while sliding', () => {
    render(
      <TooltipProvider>
        <TopicModelingResultsPanel {...baseProps} />
      </TooltipProvider>
    );

    const input = screen.getByRole('slider', { name: 'Exact Topic No. after modelling' });
    fireEvent.mouseDown(input);
    fireEvent.change(input, { target: { value: '9' } });

    expect(screen.getByText('9')).toBeInTheDocument();
  });

  it('clamps and submits the updated exact topic count on slider release', () => {
    const onUpdateExactTopicCount = vi.fn();
    render(
      <TooltipProvider>
        <TopicModelingResultsPanel
          {...baseProps}
          onUpdateExactTopicCount={onUpdateExactTopicCount}
        />
      </TooltipProvider>
    );

    const input = screen.getByRole('slider', { name: 'Exact Topic No. after modelling' });
    fireEvent.change(input, { target: { value: '20' } });
    fireEvent.mouseUp(input);

    expect(onUpdateExactTopicCount).toHaveBeenCalledWith(12);
  });
});