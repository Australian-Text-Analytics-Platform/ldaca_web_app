import { useMemo } from 'react';

/** One {topic_id, proportion} entry as delivered by the backend TMDist column. */
type DistributionEntry = { topic_id: number; proportion: number };

type Props = {
  /** Raw cell value from a TMDist column: a list of {topic_id, proportion}. */
  value: unknown;
};

/**
 * Deterministic vivid color for a topic id (stable across rows so the same
 * topic reads as the same color down a column). HSL golden-angle hashing keeps
 * adjacent topic ids visually distinct without a fixed palette.
 */
function topicColor(topicId: number): string {
  // -1 is the outlier/noise topic — render it neutral grey.
  if (topicId < 0) return 'hsl(0, 0%, 75%)';
  const hue = (topicId * 137.508) % 360;
  return `hsl(${hue.toFixed(1)}, 65%, 55%)`;
}

function parseEntries(value: unknown): DistributionEntry[] {
  if (!Array.isArray(value)) return [];
  const out: DistributionEntry[] = [];
  for (const item of value) {
    if (item && typeof item === 'object') {
      const tid = Number((item as Record<string, unknown>).topic_id);
      const prop = Number((item as Record<string, unknown>).proportion);
      if (Number.isFinite(tid) && Number.isFinite(prop) && prop > 0) {
        out.push({ topic_id: tid, proportion: prop });
      }
    }
  }
  return out;
}

/**
 * Rendered by: WorkspaceTable for columns whose canonical type is `tmdist`
 * (the topic-distribution semantic type). Shows the per-document soft topic
 * distribution as a single horizontal bar of end-to-end colored segments whose
 * widths are proportional to each topic's share. Each segment carries a native
 * tooltip ("Topic N: XX.X%"); a compact legend lists the top segments.
 *
 * Flow: parse the list-of-struct cell value, sort by proportion desc, normalize
 * widths to sum to 100%, and render proportional segments + a legend.
 */
export function TopicDistributionBar({ value }: Props) {
  const entries = useMemo(() => {
    const parsed = parseEntries(value);
    parsed.sort((a, b) => b.proportion - a.proportion);
    return parsed;
  }, [value]);

  if (entries.length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  const total = entries.reduce((sum, e) => sum + e.proportion, 0) || 1;

  return (
    <div className="flex w-full min-w-[140px] flex-col gap-1 py-0.5">
      <div
        className="flex h-4 w-full overflow-hidden rounded-sm ring-1 ring-border/60"
        role="img"
        aria-label={entries
          .map((e) => `Topic ${e.topic_id}: ${((e.proportion / total) * 100).toFixed(1)}%`)
          .join(', ')}
      >
        {entries.map((entry, i) => {
          const pct = (entry.proportion / total) * 100;
          return (
            <div
              key={`${entry.topic_id}-${i}`}
              className="h-full"
              style={{ width: `${pct}%`, backgroundColor: topicColor(entry.topic_id) }}
              title={`Topic ${entry.topic_id}: ${pct.toFixed(1)}%`}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-2 gap-y-0.5">
        {entries.slice(0, 4).map((entry, i) => {
          const pct = (entry.proportion / total) * 100;
          return (
            <span
              key={`${entry.topic_id}-${i}`}
              className="inline-flex items-center gap-1 text-[10px] leading-none text-muted-foreground"
            >
              <span
                className="inline-block h-2 w-2 rounded-[2px]"
                style={{ backgroundColor: topicColor(entry.topic_id) }}
              />
              {entry.topic_id < 0 ? 'outlier' : `T${entry.topic_id}`} {pct.toFixed(0)}%
            </span>
          );
        })}
        {entries.length > 4 ? (
          <span className="text-[10px] leading-none text-muted-foreground">
            +{entries.length - 4}
          </span>
        ) : null}
      </div>
    </div>
  );
}
