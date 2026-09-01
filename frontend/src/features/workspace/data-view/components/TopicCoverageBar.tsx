/** One semantic Topic Coverage entry decoded from Arrow. */
interface CoverageEntry {
  topic_id: number;
  coverage: number;
}

interface Props {
  /** Raw Arrow cell value: a fixed-size list of {topic_id, coverage}. */
  value: unknown;
}

/** Deterministic topic colour shared by every row in the column. */
function topicColor(topicId: number): string {
  if (topicId < 0) return 'hsl(0, 0%, 75%)';
  const hue = (topicId * 137.508) % 360;
  return `hsl(${hue.toFixed(1)}, 65%, 55%)`;
}

function parseEntries(value: unknown): CoverageEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: CoverageEntry[] = [];
  for (const item of value) {
    if (item && typeof item === 'object') {
      const topicId = Number((item as Record<string, unknown>).topic_id);
      const coverage = Number((item as Record<string, unknown>).coverage);
      if (Number.isFinite(topicId) && Number.isFinite(coverage) && coverage > 0) {
        entries.push({ topic_id: topicId, coverage });
      }
    }
  }
  return entries;
}

/** Render source-character Topic Coverage as a compact horizontal bar. */
export function TopicCoverageBar({ value }: Props) {
  const entries = parseEntries(value).sort((left, right) => right.coverage - left.coverage);

  if (entries.length === 0) {
    return <span className="text-label-secondary text-description">—</span>;
  }

  const total = entries.reduce((sum, entry) => sum + entry.coverage, 0) || 1;

  return (
    <div className="flex w-full min-w-[140px] flex-col gap-1 py-0.5">
      <div
        className="flex h-4 w-full overflow-hidden rounded-sm ring-1 ring-border/60"
        role="img"
        aria-label={entries
          .map(
            (entry) =>
              `Topic ${String(entry.topic_id)}: ${((entry.coverage / total) * 100).toFixed(1)}%`,
          )
          .join(', ')}
      >
        {entries.map((entry, index) => {
          const percentage = (entry.coverage / total) * 100;
          return (
            <div
              key={`${String(entry.topic_id)}-${String(index)}`}
              className="h-full"
              style={{
                width: `${String(percentage)}%`,
                backgroundColor: topicColor(entry.topic_id),
              }}
              title={`Topic ${String(entry.topic_id)}: ${percentage.toFixed(1)}%`}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-2 gap-y-0.5">
        {entries.slice(0, 4).map((entry, index) => {
          const percentage = (entry.coverage / total) * 100;
          return (
            <span
              key={`${String(entry.topic_id)}-${String(index)}`}
              className="inline-flex items-center gap-1 text-badge leading-none text-description"
            >
              <span
                className="inline-block h-2 w-2 rounded-[2px]"
                style={{ backgroundColor: topicColor(entry.topic_id) }}
              />
              {entry.topic_id < 0 ? 'outlier' : `T${String(entry.topic_id)}`}{' '}
              {percentage.toFixed(0)}%
            </span>
          );
        })}
        {entries.length > 4 ? (
          <span className="text-badge leading-none text-description">+{entries.length - 4}</span>
        ) : null}
      </div>
    </div>
  );
}
