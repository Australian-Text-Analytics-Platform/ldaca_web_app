export interface TopicModelingTopicPoint {
  x: number;
  y: number;
}

export interface ZoomDomain {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

export function interpolateColor(colorA: string, colorB: string, t: number): string {
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

  return `rgb(${r}, ${g}, ${b})`;
}

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

export function computeZoomDomain(topics: TopicModelingTopicPoint[]): ZoomDomain | null {
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
