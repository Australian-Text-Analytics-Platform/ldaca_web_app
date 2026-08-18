import type { TopicModelingTopic } from '@/api';
import { matchChecklistOption } from '@/features/views/common/checklistSearch';
import { interpolateColor } from '../../topicModelingAdapters';

const TOPIC_GRAPH_WIDTH = 1000;
const TOPIC_GRAPH_HEIGHT = 550;

export interface TopicGraphPoint {
  x: number;
  y: number;
}

export interface TopicGraphViewport extends TopicGraphPoint {
  zoom: number;
}

export interface TopicBubbleModel {
  id: number;
  topic: TopicModelingTopic;
  position: TopicGraphPoint;
  radius: number;
  fill: string;
  selected: boolean;
  lassoed: boolean;
  hovered: boolean;
  filteredOut: boolean;
}

interface BuildTopicBubbleModelsOptions {
  topics: TopicModelingTopic[];
  corpusCount: number;
  panelNodeIds: string[];
  nodeColors: Record<string, string>;
  defaultPalette: string[];
  selectedTopicIds: Set<number>;
  lassoTopicIds: Set<number>;
  hoveredTopicId: number | null;
  topicSearchQuery: string;
}

/** Resolves one corpus colour from persisted node metadata, then palette fallback. */
export function resolveTopicCorpusColor(
  index: number,
  fallback: string,
  panelNodeIds: string[],
  nodeColors: Record<string, string>,
  defaultPalette: string[],
): string {
  const nodeId = panelNodeIds[index];
  if (nodeId) {
    // An empty persisted colour deliberately falls through to the palette.
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
    return nodeColors[nodeId] || defaultPalette[index] || fallback;
  }
  return defaultPalette[index] ?? fallback;
}

/** Maps backend topic coordinates into the renderer's stable virtual plane. */
export function normalizeTopicPositions(
  topics: TopicModelingTopic[],
): Map<number, TopicGraphPoint> {
  if (topics.length === 0) return new Map();
  const xs = topics.map((topic) => topic.x);
  const ys = topics.map((topic) => topic.y);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const xSpan = xMax - xMin;
  const ySpan = yMax - yMin;

  return new Map(
    topics.map((topic) => [
      topic.id,
      {
        x: xSpan === 0 ? TOPIC_GRAPH_WIDTH / 2 : ((topic.x - xMin) / xSpan) * TOPIC_GRAPH_WIDTH,
        y: ySpan === 0 ? TOPIC_GRAPH_HEIGHT / 2 : ((topic.y - yMin) / ySpan) * TOPIC_GRAPH_HEIGHT,
      },
    ]),
  );
}

/** Builds the shared graph/export presentation model for every projected Topic. */
export function buildTopicBubbleModels({
  topics,
  corpusCount,
  panelNodeIds,
  nodeColors,
  defaultPalette,
  selectedTopicIds,
  lassoTopicIds,
  hoveredTopicId,
  topicSearchQuery,
}: BuildTopicBubbleModelsOptions): TopicBubbleModel[] {
  const positions = normalizeTopicPositions(topics);
  const maxSize = Math.max(1, ...topics.map((topic) => topic.total_size));
  const fallbackPrimaryColor = defaultPalette[0] ?? '#2563eb';
  const fallbackSecondaryColor = defaultPalette[1] ?? '#dc2626';
  const colorA = resolveTopicCorpusColor(
    0,
    fallbackPrimaryColor,
    panelNodeIds,
    nodeColors,
    defaultPalette,
  );
  const colorB = resolveTopicCorpusColor(
    1,
    fallbackSecondaryColor,
    panelNodeIds,
    nodeColors,
    defaultPalette,
  );
  const hasSearchFilter = topicSearchQuery.trim().length > 0;

  return topics.map((topic) => {
    const proportion =
      corpusCount === 2 && topic.total_size > 0 ? (topic.size[1] ?? 0) / topic.total_size : 0.5;
    return {
      id: topic.id,
      topic,
      position: positions.get(topic.id) ?? {
        x: TOPIC_GRAPH_WIDTH / 2,
        y: TOPIC_GRAPH_HEIGHT / 2,
      },
      radius: 10 + 40 * Math.sqrt(topic.total_size / maxSize),
      fill: corpusCount <= 1 ? colorA : interpolateColor(colorA, colorB, proportion),
      selected: selectedTopicIds.has(topic.id),
      lassoed: lassoTopicIds.has(topic.id),
      hovered: hoveredTopicId === topic.id,
      filteredOut:
        hasSearchFilter &&
        !matchChecklistOption(
          topic.representative_words.map((term) => term.word).join(', '),
          topicSearchQuery,
        ),
    };
  });
}

/** Returns whether a screen-space point lies inside a closed freehand polygon. */
function isPointInsidePolygon(point: TopicGraphPoint, polygon: TopicGraphPoint[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const currentPoint = polygon[index];
    const previousPoint = polygon[previous];
    if (!currentPoint || !previousPoint) continue;
    const crosses =
      currentPoint.y > point.y !== previousPoint.y > point.y &&
      point.x <
        ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) /
          (previousPoint.y - currentPoint.y) +
          currentPoint.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** Finds Topic centers inside a lasso after applying the current React Flow viewport. */
export function findTopicIdsInsideLasso(
  bubbles: TopicBubbleModel[],
  polygon: TopicGraphPoint[],
  viewport: TopicGraphViewport,
): Set<number> {
  return new Set(
    bubbles
      .filter((bubble) =>
        isPointInsidePolygon(
          {
            x: bubble.position.x * viewport.zoom + viewport.x,
            y: bubble.position.y * viewport.zoom + viewport.y,
          },
          polygon,
        ),
      )
      .map((bubble) => bubble.id),
  );
}
