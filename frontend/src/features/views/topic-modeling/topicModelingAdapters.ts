import type { TopicModelingTopic } from '@/api';

export interface ZoomDomain {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

/** Interpolates between two hex colours for topic bubble intensity scales. */
/**
 * Used by: useTopicModelingBubbleChart.tsx.
 * Flow: parse both hex colors into RGB triples, linearly interpolate each channel by t, then return an rgb() string.
 */
export function interpolateColor(colorA: string, colorB: string, t: number): string {
  // Parses six-character hex colours into RGB triples for interpolation.
  /**
   * Called by: interpolateColor as a local helper in this analysis workflow.
   */
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

/** Chooses readable text colour for chips rendered on arbitrary node colours. */
/**
 * Used by: useTopicModelingBubbleChart.tsx.
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

/** Computes the full zoom domain needed to fit all topic points in the chart. */
/**
 * Used by: useTopicModelingZoomBrush.ts.
 * Flow: collect topic x/y coordinates, compute min/max bounds, widen flat axes with epsilon, then return the zoom domain.
 */
export function computeZoomDomain(
  topics: Pick<TopicModelingTopic, 'x' | 'y'>[],
): ZoomDomain | null {
  if (!topics.length) return null;

  const xs = topics.map((topic) => topic.x);
  const ys = topics.map((topic) => topic.y);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const epsilon = 1e-6;

  return {
    xMin,
    xMax: xMax === xMin ? xMin + epsilon : xMax,
    yMin,
    yMax: yMax === yMin ? yMin + epsilon : yMax,
  };
}
