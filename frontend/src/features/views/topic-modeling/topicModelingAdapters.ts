import type { TopicModelingTopic } from '@/api';

export function topicRepresentativeText(topic: TopicModelingTopic): string {
  return topic.representative_words.map((term) => term.word).join(', ');
}

export function filterTopicRepresentativeWords(
  topics: TopicModelingTopic[],
  stopWords: ReadonlySet<string>,
): TopicModelingTopic[] {
  if (stopWords.size === 0) return topics;
  return topics.map((topic) => ({
    ...topic,
    representative_words: topic.representative_words.filter(
      (term) => !stopWords.has(term.word.toLocaleLowerCase()),
    ),
  }));
}

export function sliceTopicRepresentativeWords(
  topics: TopicModelingTopic[],
  count: number,
): TopicModelingTopic[] {
  const limit = Math.min(100, Math.max(3, Math.round(count)));
  return topics.map((topic) => ({
    ...topic,
    representative_words: topic.representative_words.slice(0, limit),
  }));
}

/**
 * Interpolates between two hex colours for topic bubble intensity scales.
 * Used by: topicModelingGraph to blend two corpus colours for each bubble.
 * Flow: parse both hex colors into RGB triples, linearly interpolate each channel by t, then return an rgb() string.
 */
export function interpolateColor(colorA: string, colorB: string, t: number): string {
  // Called twice by interpolateColor to parse the two endpoint colours into RGB channels.
  const parse = (color: string): [number, number, number] => {
    const parts = color
      .replace('#', '')
      .match(/.{2}/g)
      ?.map((value) => parseInt(value, 16)) ?? [0, 0, 0];
    return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
  };

  const [r1, g1, b1] = parse(colorA);
  const [r2, g2, b2] = parse(colorB);

  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);

  return `rgb(${String(r)}, ${String(g)}, ${String(b)})`;
}

/**
 * Chooses readable text colour for chips rendered on arbitrary node colours.
 * Used by: TopicModelingBubbleChartSection for corpus-size chips.
 * Flow: reject missing or non-six-digit colors to white, compute RGB luminance, then choose dark text for light fills or white text otherwise.
 */
export function getReadableTextColor(hexColor: string): string {
  if (!hexColor) return '#ffffff';
  const normalized = hexColor.replace('#', '');
  if (normalized.length !== 6) return '#ffffff';

  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;

  return luminance > 160 ? '#1e293b' : '#ffffff';
}
