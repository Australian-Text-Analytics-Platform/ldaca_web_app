import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TopicModelingBubbleChartSection } from '../TopicModelingBubbleChartSection';

vi.mock('../TopicSelectionPanel', () => ({
  TopicSelectionPanel: () => <div data-testid="topic-selection-panel" />,
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
            label: 'alpha beta gamma',
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
    expect(screen.getByText('alpha beta gamma')).toBeInTheDocument();
  });
});