import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TopicModelingBubbleChartSection } from '../TopicModelingBubbleChartSection';
import { buildTopicsCSV } from '../topicModelingCsv';

vi.mock('../TopicSelectionPanel', () => ({
  TopicSelectionPanel: () => <div data-testid="topic-selection-panel" />,
}));

vi.mock('@/features/views/common/components/ResponsiveWordCloud', () => ({
  ResponsiveWordCloud: ({ words }: { words: { text: string; value: number }[] }) => (
    <div>{words.map((word) => `${word.text}:${String(word.value)}`).join(', ')}</div>
  ),
}));

describe('TopicModelingBubbleChartSection', () => {
  it('renders the tooltip overlay outside the clipped chart shell', () => {
    render(
      <TopicModelingBubbleChartSection
        topics={[]}
        chartRef={{ current: null }}
        handleResetZoom={vi.fn()}
        isAtGlobalZoom
        bubbleElements={<svg aria-label="Topic bubble chart" />}
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
        renderSizeComposition={() => <span>4 + 6 = 10</span>}
        hoveredTopicId={null}
        setHoveredTopicId={vi.fn()}
        selectedTopicIds={new Set()}
        onToggleTopicSelection={vi.fn()}
        onClearSelection={vi.fn()}
        topicSearchQuery=""
        onTopicSearchQueryChange={vi.fn()}
        activeDomain={null}
      />,
    );

    const tooltip = screen.getByTestId('topic-bubble-chart-tooltip');
    const clippedChartShell = screen.getByTestId('topic-bubble-chart-shell');

    expect(clippedChartShell).not.toContainElement(tooltip);
    expect(tooltip).toHaveAttribute('role', 'tooltip');
    expect(screen.getByText(/alpha, 7 occurrences/)).toBeInTheDocument();
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
