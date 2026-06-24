// Callers may rely on period_start and period_end being present on chart rows.
export type SequentialAnalysisDatum = Record<string, unknown>;

export type ChartTypeOption = 'line' | 'bar' | 'area';

const CHART_TYPE_OPTIONS: ChartTypeOption[] = ['line', 'bar', 'area'];

// Narrows stored or server-provided chart type values to the supported UI options.
/**
 * Used by: SequentialAnalysisFeature and useSequentialAnalysisTaskFlow when
 * backend task results need to restore the chart type without trusting an
 * arbitrary string from persisted task payloads.
 */
export const isChartTypeOption = (value: unknown): value is ChartTypeOption =>
  typeof value === 'string' && CHART_TYPE_OPTIONS.includes(value as ChartTypeOption);

const SEQUENTIAL_ANALYSIS_PALETTE = [
  '#2563eb',
  '#16a34a',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#14b8a6',
  '#f97316',
  '#ec4899',
  '#0ea5e9',
  '#22c55e',
] as const;

// Provides deterministic colours for generated chart series.
/**
 * Used by: SequentialChart, sequential chart export helpers, and
 * useSequentialAnalysisTaskFlow so the rendered chart and downloaded chart
 * metadata assign the same fallback series colours.
 */
export const getSequentialPaletteColor = (index: number) =>
  SEQUENTIAL_ANALYSIS_PALETTE[index % SEQUENTIAL_ANALYSIS_PALETTE.length];

// Formats sequential chart x-axis labels for timestamps while preserving raw non-date values.
/**
 * Used by: SequentialChart numeric-axis tick formatting because datetime
 * columns are plotted as epoch-millisecond numbers while numeric columns should
 * keep their raw values.
 * Flow: return a placeholder for empty values, format parseable dates with
 * month/year/day detail, then preserve raw non-date labels.
 */
export const formatSequentialTimeLabel = (value?: string | number) => {
  if (value === undefined || value === '') return '—';
  // Numeric input is interpreted as epoch-milliseconds (this is what the
  // linear x-axis passes in for datetime columns). Pass it to Date directly.
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    const options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short' };
    if (
      !(parsed.getUTCDate() === 1 && parsed.getUTCHours() === 0 && parsed.getUTCMinutes() === 0)
    ) {
      options.day = 'numeric';
    }
    return parsed.toLocaleString(undefined, options);
  }
  return String(value);
};
