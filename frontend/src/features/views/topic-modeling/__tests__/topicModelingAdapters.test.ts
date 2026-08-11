import { describe, expect, it } from 'vitest';
import type { TopicModelingTopic } from '@/api';
import {
  filterTopicRepresentativeWords,
  sliceTopicRepresentativeWords,
  topicRepresentativeText,
} from '../topicModelingAdapters';

const topic: TopicModelingTopic = {
  id: 0,
  representative_words: [
    { word: 'the', occurrence_count: 20 },
    { word: 'climate', occurrence_count: 8 },
    { word: 'policy', occurrence_count: 5 },
    { word: 'future', occurrence_count: 3 },
    { word: 'energy', occurrence_count: 2 },
  ],
  size: [4],
  total_size: 4,
  x: 0,
  y: 0,
};

describe('topic representative-word projections', () => {
  it('filters before applying the visual slice', () => {
    const filtered = filterTopicRepresentativeWords([topic], new Set(['the']));
    const displayed = sliceTopicRepresentativeWords(filtered, 3);

    expect(displayed[0]?.representative_words.map((term) => term.word)).toEqual([
      'climate',
      'policy',
      'future',
    ]);
    expect(topicRepresentativeText(displayed[0]!)).toBe('climate, policy, future');
  });

  it('keeps all filtered candidates available beside the visual projection', () => {
    const filtered = filterTopicRepresentativeWords([topic], new Set(['the']));
    const displayed = sliceTopicRepresentativeWords(filtered, 3);

    expect(filtered[0]?.representative_words).toHaveLength(4);
    expect(displayed[0]?.representative_words).toHaveLength(3);
    expect(topic.representative_words).toHaveLength(5);
  });
});
