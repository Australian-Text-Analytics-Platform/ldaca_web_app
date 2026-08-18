import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';

import { TopicModelingResultsPanel } from '../TopicModelingResultsPanel';

vi.mock('../../results/TopicModelingBubbleChartSection', () => ({
  TopicModelingBubbleChartSection: ({
    controlRowSlot,
    topics,
  }: {
    controlRowSlot?: React.ReactNode;
    topics: { id: number }[];
  }) => (
    <div data-testid="topic-bubble-chart-section">
      {controlRowSlot}
      <span>All Topics ({topics.length})</span>
    </div>
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
  tooltip: { topic: null, x: 0, y: 0 },
  setTooltip: vi.fn(),
  hoveredTopicId: null,
  setHoveredTopicId: vi.fn(),
  selectedTopicIds: new Set<number>(),
  onToggleTopicSelection: vi.fn(),
  onClearSelection: vi.fn(),
  topicSearchQuery: '',
  onTopicSearchQueryChange: vi.fn(),
  corpusCount: 1,
  panelNodeIds: ['node-1'],
  nodeColors: { 'node-1': '#2563eb' },
  defaultPalette: ['#2563eb'],
  graphProjectionKey: 'analysis-1:result:4',
  onGraphViewReady: vi.fn(),
  nodeNames: ['Corpus A'],
  randomSeed: 0,
  maxSegmentTokens: 256,
  onAddToWorkspace: vi.fn(),
  isAddingToWorkspace: false,
  projectionPending: false,
  projectionError: null,
  clustering: {
    cluster_count: 4,
    min_cluster_count: 2,
    max_cluster_count: 5,
    default_cluster_count: 5,
    adjustable: true,
  },
  onClusterCountCommit: vi.fn(),
  stopWordsEnabled: false,
  onStopWordsEnabledChange: vi.fn(),
  stopWords: [],
  stopWordsDetectionTarget: { workspaceId: 'workspace-1', nodeId: 'node-1', column: 'text' },
  onStopWordsChange: vi.fn().mockResolvedValue(undefined),
};

function prepareClusterSlider() {
  const root = screen.getByTestId('topic-cluster-slider');
  let captured = false;
  Object.assign(root, {
    hasPointerCapture: () => captured,
    releasePointerCapture: () => {
      captured = false;
    },
    setPointerCapture: () => {
      captured = true;
    },
  });
  vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({
    bottom: 10,
    height: 10,
    left: 0,
    right: 100,
    top: 0,
    width: 100,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  return {
    root,
    losePointerCapture: () => {
      captured = false;
    },
  };
}

const interruptedPointerGestures: [string, (root: HTMLElement) => void][] = [
  ['pointer cancellation', (root) => fireEvent.pointerCancel(root, { pointerId: 1 })],
  ['lost pointer capture', (root) => fireEvent.lostPointerCapture(root, { pointerId: 1 })],
  ['window blur', () => fireEvent(window, new Event('blur'))],
];

describe('TopicModelingResultsPanel', () => {
  it('renders the accessible cluster slider with server-provided bounds', () => {
    render(
      <TooltipProvider>
        <TopicModelingResultsPanel {...baseProps} />
      </TooltipProvider>,
    );

    const slider = screen.getByRole('slider', { name: 'Number of clusters' });
    expect(slider).toHaveAttribute('aria-valuemin', '2');
    expect(slider).toHaveAttribute('aria-valuemax', '5');
    expect(slider).toHaveAttribute('aria-valuenow', '4');
    expect(screen.getByText('Topics (1)')).toBeInTheDocument();
  });

  it('disables the fixed control when the natural result has two Topics', () => {
    render(
      <TooltipProvider>
        <TopicModelingResultsPanel
          {...baseProps}
          clustering={{
            cluster_count: 2,
            min_cluster_count: 2,
            max_cluster_count: 2,
            default_cluster_count: 2,
            adjustable: false,
          }}
        />
      </TooltipProvider>,
    );
    expect(screen.getByRole('slider', { name: 'Number of clusters' })).toBeDisabled();
  });

  it('commits one cluster query immediately after a keyboard adjustment', () => {
    const onClusterCountCommit = vi.fn();
    render(
      <TooltipProvider>
        <TopicModelingResultsPanel {...baseProps} onClusterCountCommit={onClusterCountCommit} />
      </TooltipProvider>,
    );

    const slider = screen.getByRole('slider', { name: 'Number of clusters' });
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(onClusterCountCommit).toHaveBeenCalledTimes(1);
    expect(onClusterCountCommit).toHaveBeenCalledWith(3);
    fireEvent.keyUp(slider, { key: 'ArrowLeft' });
    expect(onClusterCountCommit).toHaveBeenCalledTimes(1);
  });

  it('commits the latest draft once on release even after pointer capture is lost', () => {
    const onClusterCountCommit = vi.fn();
    render(
      <TooltipProvider>
        <TopicModelingResultsPanel {...baseProps} onClusterCountCommit={onClusterCountCommit} />
      </TooltipProvider>,
    );

    const { root, losePointerCapture } = prepareClusterSlider();

    fireEvent.pointerDown(root, { button: 0, clientX: 0, pointerId: 1 });
    expect(onClusterCountCommit).not.toHaveBeenCalled();
    expect(screen.getByRole('slider', { name: 'Number of clusters' })).toHaveAttribute(
      'aria-valuenow',
      '2',
    );
    losePointerCapture();
    fireEvent.pointerUp(root, { button: 0, clientX: 0, pointerId: 1 });

    expect(onClusterCountCommit).toHaveBeenCalledTimes(1);
    expect(onClusterCountCommit).toHaveBeenCalledWith(2);
  });

  it('commits the latest draft when movement and release complete before a render', () => {
    const onClusterCountCommit = vi.fn();
    render(
      <TooltipProvider>
        <TopicModelingResultsPanel {...baseProps} onClusterCountCommit={onClusterCountCommit} />
      </TooltipProvider>,
    );

    const { root } = prepareClusterSlider();
    act(() => {
      root.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 0, pointerId: 1 }),
      );
      root.dispatchEvent(
        new PointerEvent('pointerup', { bubbles: true, button: 0, clientX: 0, pointerId: 1 }),
      );
    });

    expect(onClusterCountCommit).toHaveBeenCalledTimes(1);
    expect(onClusterCountCommit).toHaveBeenCalledWith(2);
  });

  it.each(
    interruptedPointerGestures,
  )('rolls the draft back without committing after %s', (_reason, interrupt) => {
    const onClusterCountCommit = vi.fn();
    render(
      <TooltipProvider>
        <TopicModelingResultsPanel {...baseProps} onClusterCountCommit={onClusterCountCommit} />
      </TooltipProvider>,
    );

    const { root } = prepareClusterSlider();
    fireEvent.pointerDown(root, { button: 0, clientX: 0, pointerId: 1 });
    expect(screen.getByRole('slider', { name: 'Number of clusters' })).toHaveAttribute(
      'aria-valuenow',
      '2',
    );

    interrupt(root);

    expect(onClusterCountCommit).not.toHaveBeenCalled();
    expect(screen.getByRole('slider', { name: 'Number of clusters' })).toHaveAttribute(
      'aria-valuenow',
      '4',
    );
  });

  it('does not commit when a pointer gesture finishes at the applied count', () => {
    const onClusterCountCommit = vi.fn();
    render(
      <TooltipProvider>
        <TopicModelingResultsPanel {...baseProps} onClusterCountCommit={onClusterCountCommit} />
      </TooltipProvider>,
    );

    const { root } = prepareClusterSlider();

    fireEvent.pointerDown(root, { button: 0, clientX: 66, pointerId: 1 });
    fireEvent.pointerUp(root, { button: 0, clientX: 66, pointerId: 1 });

    expect(onClusterCountCommit).not.toHaveBeenCalled();
  });

  it('makes the complete Result content inert while a cluster projection is loading', () => {
    const { rerender } = render(
      <TooltipProvider>
        <TopicModelingResultsPanel {...baseProps} projectionPending />
      </TooltipProvider>,
    );

    const content = screen.getByTestId('topic-modeling-result-content');
    expect(content).toHaveAttribute('inert');
    expect(content).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Updating topics…');

    const projectedTopics = [...baseProps.topics, { ...baseProps.topics[0], id: 2, x: 1, y: 1 }];
    rerender(
      <TooltipProvider>
        <TopicModelingResultsPanel
          {...baseProps}
          topics={projectedTopics}
          clustering={{ ...baseProps.clustering, cluster_count: 2 }}
          projectionPending={false}
        />
      </TooltipProvider>,
    );

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByTestId('topic-modeling-result-content')).not.toHaveAttribute('inert');
    expect(screen.getByText('Topics (2)')).toBeInTheDocument();
    expect(screen.getByText('All Topics (2)')).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Number of clusters' })).toHaveAttribute(
      'aria-valuenow',
      '2',
    );
  });

  it('resets a stale slider draft when a different projection is applied', () => {
    const { rerender } = render(
      <TooltipProvider>
        <TopicModelingResultsPanel {...baseProps} />
      </TooltipProvider>,
    );

    fireEvent.keyDown(screen.getByRole('slider', { name: 'Number of clusters' }), {
      key: 'ArrowLeft',
    });
    expect(screen.getByRole('slider', { name: 'Number of clusters' })).toHaveAttribute(
      'aria-valuenow',
      '3',
    );

    rerender(
      <TooltipProvider>
        <TopicModelingResultsPanel
          {...baseProps}
          clustering={{ ...baseProps.clustering, cluster_count: 2 }}
        />
      </TooltipProvider>,
    );

    expect(screen.getByRole('slider', { name: 'Number of clusters' })).toHaveAttribute(
      'aria-valuenow',
      '2',
    );
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
