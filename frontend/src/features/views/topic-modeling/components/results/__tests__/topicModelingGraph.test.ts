import { describe, expect, it } from 'vitest';

import {
  buildTopicBubbleModels,
  findTopicIdsInsideLasso,
  normalizeTopicPositions,
} from '../topicModelingGraph';

const topics = [
  {
    id: 0,
    representative_words: [{ word: 'alpha', occurrence_count: 4 }],
    size: [4],
    total_size: 4,
    x: -5,
    y: 10,
  },
  {
    id: 1,
    representative_words: [{ word: 'beta', occurrence_count: 3 }],
    size: [3],
    total_size: 3,
    x: 5,
    y: 20,
  },
];

describe('topicModelingGraph', () => {
  it('normalizes every topic into a stable plane and centers flat axes', () => {
    expect(normalizeTopicPositions(topics)).toEqual(
      new Map([
        [0, { x: 0, y: 0 }],
        [1, { x: 1000, y: 550 }],
      ]),
    );

    expect(normalizeTopicPositions([{ ...topics[0], x: 2, y: 2 }])).toEqual(
      new Map([[0, { x: 500, y: 275 }]]),
    );
  });

  it('builds bounded bubble models with search, selection, and lasso presentation state', () => {
    const bubbles = buildTopicBubbleModels({
      topics,
      corpusSizes: [4],
      panelNodeIds: ['corpus-a'],
      nodeColors: { 'corpus-a': '#ff0000' },
      defaultPalette: ['#0000ff'],
      selectedTopicIds: new Set([0]),
      lassoTopicIds: new Set([1]),
      hoveredTopicId: 1,
      topicSearchQuery: 'alpha',
    });

    expect(bubbles).toHaveLength(2);
    expect(bubbles[0]).toMatchObject({
      id: 0,
      fill: '#ff0000',
      selected: true,
      lassoed: false,
      filteredOut: false,
      position: { x: 0, y: 0 },
    });
    expect(bubbles[1]).toMatchObject({
      id: 1,
      hovered: true,
      lassoed: true,
      filteredOut: true,
      position: { x: 1000, y: 550 },
    });
    expect(bubbles.every((bubble) => bubble.radius >= 10 && bubble.radius <= 50)).toBe(true);
  });

  it('normalizes two-corpus colours by each corpus row count', () => {
    const bubbles = buildTopicBubbleModels({
      topics: [
        {
          id: 0,
          representative_words: [{ word: 'balanced', occurrence_count: 12 }],
          size: [10, 2],
          total_size: 12,
          x: 0,
          y: 0,
        },
      ],
      corpusSizes: [100, 20],
      panelNodeIds: [],
      nodeColors: {},
      defaultPalette: ['#0000ff', '#ff0000'],
      selectedTopicIds: new Set(),
      lassoTopicIds: new Set(),
      hoveredTopicId: null,
      topicSearchQuery: '',
    });

    expect(bubbles[0]?.fill).toBe('rgb(128, 0, 128)');
  });

  it('omits zero-total topics before normalizing bubble positions', () => {
    const bubbles = buildTopicBubbleModels({
      topics: [
        ...topics,
        {
          id: 2,
          representative_words: [{ word: 'zero', occurrence_count: 1 }],
          size: [0],
          total_size: 0,
          x: -100,
          y: -100,
        },
        {
          id: 3,
          representative_words: [{ word: 'also-zero', occurrence_count: 1 }],
          size: [0, 0],
          total_size: 0,
          x: 100,
          y: 100,
        },
      ],
      corpusSizes: [4, 3],
      panelNodeIds: [],
      nodeColors: {},
      defaultPalette: ['#0000ff', '#ff0000'],
      selectedTopicIds: new Set(),
      lassoTopicIds: new Set(),
      hoveredTopicId: null,
      topicSearchQuery: '',
    });

    expect(bubbles.map((bubble) => bubble.id)).toEqual([0, 1]);
    expect(bubbles.map((bubble) => bubble.position)).toEqual([
      { x: 0, y: 0 },
      { x: 1000, y: 550 },
    ]);
  });

  it('uses bubble centers and the current viewport for an additive lasso hit set', () => {
    const bubbles = buildTopicBubbleModels({
      topics,
      corpusSizes: [4],
      panelNodeIds: [],
      nodeColors: {},
      defaultPalette: ['#0000ff'],
      selectedTopicIds: new Set(),
      lassoTopicIds: new Set(),
      hoveredTopicId: null,
      topicSearchQuery: '',
    });

    const ids = findTopicIdsInsideLasso(
      bubbles,
      [
        { x: 15, y: 15 },
        { x: 35, y: 15 },
        { x: 35, y: 35 },
        { x: 15, y: 35 },
      ],
      { x: 25, y: 25, zoom: 1 },
    );

    expect(ids).toEqual(new Set([0]));
  });
});
