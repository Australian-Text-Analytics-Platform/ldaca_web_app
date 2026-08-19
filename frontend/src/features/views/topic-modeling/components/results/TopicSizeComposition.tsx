import { getReadableTextColor } from '../../topicModelingAdapters';
import { resolveTopicCorpusColor } from './topicModelingGraph';

export interface TopicCorpusPresentation {
  corpusCount: number;
  panelNodeIds: string[];
  nodeColors: Record<string, string>;
  defaultPalette: string[];
}

interface Props extends TopicCorpusPresentation {
  sizes: number[] | undefined;
  total?: number | null;
}

/** Renders corpus counts with the same persisted colours used by graph bubbles. */
export function TopicSizeComposition({
  sizes,
  total,
  corpusCount,
  panelNodeIds,
  nodeColors,
  defaultPalette,
}: Props) {
  if (corpusCount === 0 || !sizes) return null;
  const colorA = resolveTopicCorpusColor(
    0,
    defaultPalette[0] ?? '#2563eb',
    panelNodeIds,
    nodeColors,
    defaultPalette,
  );
  const colorB = resolveTopicCorpusColor(
    1,
    defaultPalette[1] ?? '#dc2626',
    panelNodeIds,
    nodeColors,
    defaultPalette,
  );
  if (sizes.length === 1) {
    return (
      <span className="inline-flex items-center gap-1">
        <span
          style={{ background: colorA, color: getReadableTextColor(colorA) }}
          className="rounded px-1.5 py-0.5 text-[10px] font-medium"
        >
          {sizes[0]}
        </span>
        <span className="text-[10px] text-muted-foreground">= {total}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span
        style={{ background: colorA, color: getReadableTextColor(colorA) }}
        className="rounded px-1.5 py-0.5 text-[10px] font-medium"
      >
        {sizes[0]}
      </span>
      <span className="text-[10px] text-muted-foreground">+</span>
      <span
        style={{ background: colorB, color: getReadableTextColor(colorB) }}
        className="rounded px-1.5 py-0.5 text-[10px] font-medium"
      >
        {sizes[1]}
      </span>
      <span className="text-[10px] text-muted-foreground">= {total}</span>
    </span>
  );
}
