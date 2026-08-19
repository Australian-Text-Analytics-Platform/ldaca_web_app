import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TopicModelingBubbleChartSection } from '../TopicModelingBubbleChartSection';
import { buildTopicsCSV } from '../topicModelingCsv';
import type { TopicBubbleModel } from '../topicModelingGraph';

vi.mock('../TopicModelingFlowChart', () => ({
  TopicModelingFlowChart: ({
    lassoMode,
    lassoFilterActive,
    onToggleLassoMode,
    onClearLassoFilter,
    onAddLassoTopics,
    bubbles,
  }: {
    lassoMode: boolean;
    lassoFilterActive: boolean;
    onToggleLassoMode: () => void;
    onClearLassoFilter: () => void;
    onAddLassoTopics: (ids: Set<number>) => void;
    bubbles: TopicBubbleModel[];
  }) => (
    <div data-testid="topic-flow-chart">
      <span>{lassoMode ? 'lasso enabled' : 'pan enabled'}</span>
      <span>
        Hovered topics: {bubbles.filter((bubble) => bubble.hovered).map((bubble) => bubble.id)}
      </span>
      <button type="button" onClick={onToggleLassoMode}>
        Toggle lasso
      </button>
      <button type="button" onClick={() => onAddLassoTopics(new Set([0]))}>
        Lasso zero
      </button>
      <button type="button" onClick={() => onAddLassoTopics(new Set([1]))}>
        Lasso one
      </button>
      <button type="button" disabled={!lassoFilterActive} onClick={onClearLassoFilter}>
        Clear filter
      </button>
    </div>
  ),
}));

vi.mock('../TopicSelectionPanel', () => ({
  TopicSelectionPanel: ({
    lassoTopicIds,
    onHoveredTopicChange,
  }: {
    lassoTopicIds: Set<number>;
    onHoveredTopicChange: (topicId: number | null) => void;
  }) => (
    <div data-testid="topic-selection-panel">
      <span>Lasso topics: {[...lassoTopicIds].join(',')}</span>
      <button type="button" onMouseEnter={() => onHoveredTopicChange(0)}>
        Hover topic zero
      </button>
      <button type="button" onMouseEnter={() => onHoveredTopicChange(null)}>
        Leave topic zero
      </button>
    </div>
  ),
}));

const commonProps = {
  selectedTopicIds: new Set<number>(),
  onToggleTopicSelection: vi.fn(),
  onClearSelection: vi.fn(),
  topicSearchQuery: '',
  onTopicSearchQueryChange: vi.fn(),
  corpusSizes: [100, 100],
  panelNodeIds: ['a', 'b'],
  nodeColors: { a: '#7c3aed', b: '#dc2626' },
  defaultPalette: ['#7c3aed', '#dc2626'],
  projectionKey: 'analysis-1:1',
  onViewReady: vi.fn(),
};

describe('TopicModelingBubbleChartSection', () => {
  it('keeps list hover local and resets it when the graph projection changes', () => {
    const topic = {
      id: 0,
      representative_words: [{ word: 'alpha', occurrence_count: 4 }],
      size: [4, 0],
      total_size: 4,
      x: 0,
      y: 0,
    };
    const view = render(<TopicModelingBubbleChartSection {...commonProps} topics={[topic]} />);

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Hover topic zero' }));
    expect(screen.getByText('Hovered topics: 0')).toBeInTheDocument();

    view.rerender(
      <TopicModelingBubbleChartSection
        {...commonProps}
        projectionKey="analysis-1:2"
        topics={[topic]}
      />,
    );
    expect(screen.getByText('Hovered topics:')).toBeInTheDocument();
  });

  it('keeps lasso mode sticky and unions repeated lasso results until cleared', () => {
    const view = render(<TopicModelingBubbleChartSection {...commonProps} topics={[]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Toggle lasso' }));
    expect(screen.getByText('lasso enabled')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Lasso zero' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lasso one' }));
    expect(screen.getByText('Lasso topics: 0,1')).toBeInTheDocument();

    view.rerender(<TopicModelingBubbleChartSection {...commonProps} topics={[]} />);
    expect(screen.getByText('Lasso topics: 0,1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear filter' }));
    expect(screen.getByText('Lasso topics:')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear filter' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Lasso zero' }));

    view.rerender(
      <TopicModelingBubbleChartSection {...commonProps} projectionKey="analysis-1:2" topics={[]} />,
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
