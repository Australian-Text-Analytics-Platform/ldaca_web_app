import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TopicModelingBubbleChartSection } from '../TopicModelingBubbleChartSection';
import { buildTopicsCSV } from '../topicModelingCsv';

vi.mock('../TopicModelingFlowChart', () => ({
  TopicModelingFlowChart: ({
    lassoMode,
    onToggleLassoMode,
    onAddLassoTopics,
  }: {
    lassoMode: boolean;
    onToggleLassoMode: () => void;
    onAddLassoTopics: (ids: Set<number>) => void;
  }) => (
    <div data-testid="topic-flow-chart">
      <span>{lassoMode ? 'lasso enabled' : 'pan enabled'}</span>
      <button type="button" onClick={onToggleLassoMode}>
        Toggle lasso
      </button>
      <button type="button" onClick={() => onAddLassoTopics(new Set([0]))}>
        Lasso zero
      </button>
      <button type="button" onClick={() => onAddLassoTopics(new Set([1]))}>
        Lasso one
      </button>
    </div>
  ),
}));

vi.mock('../TopicSelectionPanel', () => ({
  TopicSelectionPanel: ({
    lassoTopicIds,
    onClearLassoFilter,
  }: {
    lassoTopicIds: Set<number>;
    onClearLassoFilter: () => void;
  }) => (
    <div data-testid="topic-selection-panel">
      <span>Lasso topics: {[...lassoTopicIds].join(',')}</span>
      <button type="button" onClick={onClearLassoFilter}>
        Clear filter
      </button>
    </div>
  ),
}));

vi.mock('@/features/views/common/components/ResponsiveWordCloud', () => ({
  ResponsiveWordCloud: ({ words }: { words: { text: string; value: number }[] }) => (
    <div>{words.map((word) => `${word.text}:${String(word.value)}`).join(', ')}</div>
  ),
}));

const commonProps = {
  setTooltip: vi.fn(),
  hoveredTopicId: null,
  setHoveredTopicId: vi.fn(),
  selectedTopicIds: new Set<number>(),
  onToggleTopicSelection: vi.fn(),
  onClearSelection: vi.fn(),
  topicSearchQuery: '',
  onTopicSearchQueryChange: vi.fn(),
  corpusCount: 2,
  panelNodeIds: ['a', 'b'],
  nodeColors: { a: '#7c3aed', b: '#dc2626' },
  defaultPalette: ['#7c3aed', '#dc2626'],
  projectionKey: 'analysis-1:1',
  onViewReady: vi.fn(),
};

describe('TopicModelingBubbleChartSection', () => {
  it('renders the tooltip overlay outside the clipped chart shell', () => {
    render(
      <TopicModelingBubbleChartSection
        {...commonProps}
        topics={[]}
        tooltip={{
          x: 120,
          y: 80,
          topic: {
            id: 31,
            representative_words: [
              { word: 'alpha', occurrence_count: 7 },
              { word: 'beta', occurrence_count: 3 },
            ],
            size: [4, 6],
            total_size: 10,
            x: 0,
            y: 0,
          },
        }}
      />,
    );

    const tooltip = screen.getByTestId('topic-bubble-chart-tooltip');
    const clippedChartShell = screen.getByTestId('topic-bubble-chart-shell');
    expect(clippedChartShell).not.toContainElement(tooltip);
    expect(tooltip).toHaveAttribute('role', 'tooltip');
    expect(screen.getByText(/alpha, 7 occurrences/)).toBeInTheDocument();
  });

  it('keeps lasso mode sticky and unions repeated lasso results until cleared', () => {
    const view = render(
      <TopicModelingBubbleChartSection
        {...commonProps}
        topics={[]}
        tooltip={{ topic: null, x: 0, y: 0 }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Toggle lasso' }));
    expect(screen.getByText('lasso enabled')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Lasso zero' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lasso one' }));
    expect(screen.getByText('Lasso topics: 0,1')).toBeInTheDocument();

    view.rerender(
      <TopicModelingBubbleChartSection
        {...commonProps}
        projectionKey="analysis-1:2"
        topics={[]}
        tooltip={{ topic: null, x: 0, y: 0 }}
      />,
    );
    expect(screen.getByText('lasso enabled')).toBeInTheDocument();
    expect(screen.getByText('Lasso topics:')).toBeInTheDocument();
  });

  it('exports complete counted candidates in one topic row', () => {
    const csv = buildTopicsCSV(
      [
        {
          id: 1,
          representative_words: [
            { word: 'climate', occurrence_count: 8 },
            { word: 'policy', occurrence_count: 5 },
          ],
          size: [4],
          total_size: 4,
          x: 0,
          y: 0,
        },
      ],
      new Set(),
      ['Corpus'],
    );

    expect(csv).toContain('climate (8), policy (5)');
    expect(csv.split('\r\n')).toHaveLength(2);
  });
});
