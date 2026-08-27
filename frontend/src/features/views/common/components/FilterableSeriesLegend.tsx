export interface FilterableSeriesLegendItem {
  key: string;
  color: string;
  text: string;
  label: string;
  hidden: boolean;
  marker?: 'line' | 'bar' | 'area';
}

interface Props {
  items: readonly FilterableSeriesLegendItem[];
  onToggle?: (key: string) => void;
  ariaLabel?: string;
  className?: string;
  pressedWhenHidden?: boolean;
}

/** Application-owned series visibility used by charts and derived outputs. */
export function FilterableSeriesLegend({
  items,
  onToggle,
  ariaLabel = 'Chart series',
  className = 'flex flex-wrap items-center gap-3',
  pressedWhenHidden = false,
}: Props) {
  return (
    <div role="group" aria-label={ariaLabel} className={className}>
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          className={`flex items-center gap-2 rounded-sm px-1 py-0.5 transition-opacity hover:bg-panel/60 ${
            item.hidden ? 'opacity-50 line-through' : ''
          }`}
          disabled={!onToggle}
          aria-pressed={pressedWhenHidden ? item.hidden : !item.hidden}
          title={item.hidden ? `Show ${item.label}` : `Hide ${item.label}`}
          onClick={() => {
            onToggle?.(item.key);
          }}
        >
          {item.marker === 'bar' ? (
            <span
              className="inline-block h-3 w-3 rounded-sm"
              style={{ backgroundColor: item.color }}
              aria-hidden="true"
            />
          ) : (
            <span
              className="inline-block h-0.5 w-5"
              style={{ backgroundColor: item.color }}
              aria-hidden="true"
            />
          )}
          <span>{item.text}</span>
        </button>
      ))}
    </div>
  );
}
