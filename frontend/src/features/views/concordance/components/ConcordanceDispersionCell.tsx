type ConcordanceGroupedRow = Record<string, unknown>[];
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { CONCORDANCE_COLUMN_KEYS } from '../../common/generatedColumns';
import { getConcordanceSourceColor } from '../concordanceSourceDomain';
import { toCellText } from '../concordanceTableDomain';

interface Props {
  hits: ConcordanceGroupedRow;
  textLength?: number;
  barWidthPercent?: number;
  sourceColor?: string;
  sourceColorMap?: Record<string, string>;
  defaultPalette?: string[];
  termColors?: Record<string, string>;
}

const DEFAULT_BAR_COLOR = '#0284c7';

/** Used by: ConcordanceDispersionCell to normalize source offsets before plotting hit markers. */
const getNumericIndex = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, value);
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? null : Math.max(0, parsed);
  }
  return null;
};

/**
 * Rendered by: ConcordanceDispersionNodeBlock and dispersion-cell tests as the compact per-document hit map.
 */
export function ConcordanceDispersionCell({
  hits,
  textLength,
  barWidthPercent = 100,
  sourceColor = DEFAULT_BAR_COLOR,
  sourceColorMap = {},
  defaultPalette = [],
  termColors = {},
}: Props) {
  const fallbackLength = hits.reduce((max, hit) => {
    const endIndex = getNumericIndex(hit[CONCORDANCE_COLUMN_KEYS.endIdx]);
    return endIndex === null ? max : Math.max(max, endIndex);
  }, 0);
  const domain = Math.max(textLength ?? 0, fallbackLength, 1);
  const widthPercent = Math.max(0, Math.min(barWidthPercent, 100));
  const hasSourcePalette = Object.keys(sourceColorMap).length > 0 || defaultPalette.length > 0;

  return (
    <TooltipProvider delayDuration={120} skipDelayDuration={0}>
      <div className="w-full">
        <div
          className="relative h-6 overflow-hidden rounded-sm bg-panel"
          data-testid="concordance-dispersion-bar"
          style={{ width: `${String(widthPercent)}%` }}
        >
          <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-chart-grid" />
          {hits.map((hit, index) => {
            const startIndex = getNumericIndex(hit[CONCORDANCE_COLUMN_KEYS.startIdx]);
            if (startIndex === null) {
              return null;
            }
            const rawText = toCellText(hit[CONCORDANCE_COLUMN_KEYS.matchedText]);
            const leftPercent = Math.min(100, (startIndex / domain) * 100);
            const hitSource = hit.__source_node;
            const matchColor =
              termColors[rawText] ??
              (hitSource && hasSourcePalette
                ? getConcordanceSourceColor(hitSource, sourceColorMap, defaultPalette)
                : sourceColor);
            const leftContext = toCellText(hit[CONCORDANCE_COLUMN_KEYS.leftContext]);
            const rightContext = toCellText(hit[CONCORDANCE_COLUMN_KEYS.rightContext]);
            return (
              <Tooltip key={`${String(startIndex)}-${String(index)}`}>
                <TooltipTrigger asChild>
                  <span
                    className="absolute top-0 h-full w-1.5 -translate-x-1/2 cursor-default"
                    style={{ left: `${String(leftPercent)}%` }}
                  >
                    <span
                      data-testid="concordance-match-marker"
                      className="pointer-events-none absolute top-1/2 left-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
                      style={{ backgroundColor: matchColor }}
                    />
                  </span>
                </TooltipTrigger>
                <TooltipContent
                  side="top"
                  className="max-w-md whitespace-normal break-words border border-surface-border bg-surface px-3 py-2 text-label-secondary text-black"
                >
                  <span>{leftContext} </span>
                  <span style={{ color: matchColor, fontWeight: 600 }}>{rawText}</span>
                  <span> {rightContext}</span>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </div>
    </TooltipProvider>
  );
}
