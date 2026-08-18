import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TopicSelectionPanel } from '../TopicSelectionPanel';

const topics = [
  {
    id: 0,
    representative_words: [{ word: 'alpha', occurrence_count: 4 }],
    size: [4],
    total_size: 4,
    x: 0,
    y: 0,
  },
  {
    id: 1,
    representative_words: [{ word: 'beta', occurrence_count: 3 }],
    size: [3],
    total_size: 3,
    x: 1,
    y: 1,
  },
  {
    id: 2,
    representative_words: [{ word: 'alphabet', occurrence_count: 2 }],
    size: [2],
    total_size: 2,
    x: 2,
    y: 2,
  },
];

describe('TopicSelectionPanel', () => {
  it('intersects the additive lasso filter with search while keeping manual selections separate', () => {
    const clearLasso = vi.fn();
    render(
      <TopicSelectionPanel
        topics={topics}
        selectedTopicIds={new Set([1])}
        onToggleTopicSelection={vi.fn()}
        onClearSelection={vi.fn()}
        topicSearchQuery="alpha"
        onTopicSearchQueryChange={vi.fn()}
        lassoTopicIds={new Set([0, 1, 2])}
        onClearLassoFilter={clearLasso}
        renderSizeComposition={() => null}
        hoveredTopicId={null}
        setHoveredTopicId={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Selected Topics (1)' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'All Topics (2 of 3)' })).toBeInTheDocument();
    expect(screen.getAllByText('Topic 1')).toHaveLength(1);
    expect(screen.getByText('Topic 0')).toBeInTheDocument();
    expect(screen.getByText('Topic 2')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear lasso filter' }));
    expect(clearLasso).toHaveBeenCalledOnce();
  });

  it('shows all topics when no lasso filter is active', () => {
    render(
      <TopicSelectionPanel
        topics={topics}
        selectedTopicIds={new Set()}
        onToggleTopicSelection={vi.fn()}
        onClearSelection={vi.fn()}
        topicSearchQuery=""
        onTopicSearchQueryChange={vi.fn()}
        lassoTopicIds={new Set()}
        onClearLassoFilter={vi.fn()}
        renderSizeComposition={() => null}
        hoveredTopicId={null}
        setHoveredTopicId={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: 'All Topics (3)' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear lasso filter' })).not.toBeInTheDocument();
  });
});
