import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';

import { TopicModelingResultsPanel } from '../TopicModelingResultsPanel';

vi.mock('../results/TopicModelingBubbleChartSection', () => ({
  TopicModelingBubbleChartSection: ({ controlRowSlot }: { controlRowSlot?: React.ReactNode }) => (
    <div data-testid="topic-bubble-chart-section">{controlRowSlot}</div>
  ),
}));

vi.mock('../../TopicModelingStopWordsControl', () => ({
  TopicModelingStopWordsControl: ({
    enabled,
    onEnabledChange,
  }: {
    enabled: boolean;
    onEnabledChange: (enabled: boolean) => void;
  }) => (
    <>
      <button
        type="button"
        role="switch"
        aria-label="Filter stop words"
        aria-checked={enabled}
        onClick={() => {
          onEnabledChange(!enabled);
        }}
      />
      <button type="button" aria-label="Stop words language" />
      <button type="button" aria-label="Edit stop words" />
    </>
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
          representative_words: [
            { word: 'alpha', occurrence_count: 4 },
            { word: 'beta', occurrence_count: 2 },
          ],
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
      representative_words: [
        { word: 'alpha', occurrence_count: 4 },
        { word: 'beta', occurrence_count: 2 },
      ],
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
  maxSegmentTokens: 256,
  onAddToWorkspace: vi.fn(),
  isAddingToWorkspace: false,
  stopWordsEnabled: false,
  onStopWordsEnabledChange: vi.fn(),
  stopWords: [],
  stopWordsDetectionTarget: { workspaceId: 'workspace-1', nodeId: 'node-1', column: 'text' },
  onStopWordsChange: vi.fn().mockResolvedValue(undefined),
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

    expect(screen.getByText('Topic Modelling Results')).toBeInTheDocument();
    expect(screen.getByText('Topics (1)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add to Workspace' })).toBeInTheDocument();
  });

  it('keeps filtering off while stop-word configuration remains editable', () => {
    const onWordsPerTopicChange = vi.fn();
    const onStopWordsEnabledChange = vi.fn();
    render(
      <TooltipProvider>
        <TopicModelingResultsPanel
          {...baseProps}
          wordsPerTopic={15}
          onWordsPerTopicChange={onWordsPerTopicChange}
          stopWordsEnabled={false}
          onStopWordsEnabledChange={onStopWordsEnabledChange}
        />
      </TooltipProvider>,
    );

    expect(screen.getByLabelText('Stop words language')).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Edit stop words' })).toBeEnabled();
    fireEvent.click(screen.getByRole('switch', { name: 'Filter stop words' }));
    expect(onStopWordsEnabledChange).toHaveBeenCalledWith(true);

    const count = screen.getByLabelText('Words per topic');
    fireEvent.change(count, { target: { value: '101' } });
    fireEvent.blur(count);
    expect(onWordsPerTopicChange).toHaveBeenCalledWith(100);
  });

  it('warns when later text was truncated from Topic Segments', () => {
    render(
      <TooltipProvider>
        <TopicModelingResultsPanel
          {...baseProps}
          result={{
            ...baseProps.result,
            data: {
              ...baseProps.result.data,
              meta: { n_chunks: 742, truncated_segment_count: 18 },
            },
          }}
        />
      </TooltipProvider>,
    );

    expect(
      screen.getByText(
        '18 of 742 Topic Segments were truncated to 256 tokens; later text in those segments was not modelled.',
      ),
    ).toBeInTheDocument();
  });
});
