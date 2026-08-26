import type { SequentialAnalysisRequest, SequentialAnalysisResponse } from '@/api';
import type {
  MultiSeriesChartSeries,
  MultiSeriesChartXAxisConfig,
} from '@/features/views/common/components/MultiSeriesChart';
import type { ChartExportLegendItem } from '@/lib/chartExport';

type SequentialAnalysisDatum = Record<string, unknown>;
export type ChartTypeOption = 'line' | 'bar' | 'area';
export type SequentialXAxisType = 'category' | 'number';
type SequentialFrequency = NonNullable<SequentialAnalysisRequest['frequency']>;
type SequentialCustomIntervalUnit = NonNullable<SequentialAnalysisRequest['custom_interval_unit']>;

const NUMERIC_X_KEY = '__x_numeric__';

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

/** Assigns deterministic colours shared by chart, legend, and export metadata. */
const getSequentialPaletteColor = (index: number) => {
  const colorIndex = index % SEQUENTIAL_ANALYSIS_PALETTE.length;
  return SEQUENTIAL_ANALYSIS_PALETTE.reduce<string>(
    (selected, color, paletteIndex) => (paletteIndex === colorIndex ? color : selected),
    SEQUENTIAL_ANALYSIS_PALETTE[0],
  );
};

/** Formats datetime axis values while preserving non-date category labels. */
const formatSequentialTimeLabel = (value?: string | number) => {
  if (value === undefined || value === '') return '—';
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

/** Formats a linear-axis coordinate according to the result's declared domain. */
function formatSequentialAxisTick(value: unknown, columnType: 'datetime' | 'numeric'): string {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return '';
  return columnType === 'datetime' ? formatSequentialTimeLabel(numeric) : String(numeric);
}

export interface SequentialResultSummaryFallbacks {
  timeColumn: string;
  groupBy: string[];
  columnType: 'datetime' | 'numeric';
  numericOrigin: number | null;
  numericInterval: number | null;
  frequency: SequentialFrequency;
  customIntervalValue: number | null;
  customIntervalUnit: SequentialCustomIntervalUnit | null;
}

type SequentialChartParameters = Partial<
  Pick<
    SequentialAnalysisRequest,
    | 'time_column'
    | 'group_by_columns'
    | 'column_type'
    | 'numeric_origin'
    | 'numeric_interval'
    | 'frequency'
    | 'custom_interval_value'
    | 'custom_interval_unit'
  >
>;

interface SequentialResultSummary {
  timeColumn: string;
  groupBy: string[];
  columnType: 'datetime' | 'numeric';
  numericOrigin: number | null;
  numericInterval: number | null;
  rawFrequency: SequentialFrequency;
  customIntervalValue: number | null;
  customIntervalUnit: SequentialCustomIntervalUnit | null;
  frequencyDisplay: string;
}

interface SequentialChartDiagnostic {
  code:
    | 'invalid-group-columns'
    | 'invalid-period'
    | 'invalid-count'
    | 'invalid-group-value'
    | 'invalid-parameters';
  message: string;
  rowIndex?: number;
}

type SequentialGroupValue = string | number | boolean | null;

interface SequentialCanonicalRow {
  periodKey: string;
  timePeriod: string | number;
  axisValue: string | number;
  periodStart: string | number;
  periodEnd: string | number;
  count: number;
  groupId: string;
  groupLabel: string;
  groupValues: Record<string, SequentialGroupValue>;
}

interface SequentialChartGroup {
  id: string;
  label: string;
  color: string;
  hidden: boolean;
  values: Record<string, SequentialGroupValue>;
}

interface SequentialVisibilityCounts {
  totalPointCount: number;
  totalDocumentCount: number;
  shownPointCount: number;
  shownDocumentCount: number;
  chosenPointCount: number;
  chosenDocumentCount: number;
}

export interface BuildSequentialChartModelInput {
  results: SequentialAnalysisResponse | null | undefined;
  parameters: SequentialChartParameters | null | undefined;
  fallbacks: SequentialResultSummaryFallbacks;
  chartType: ChartTypeOption;
  xAxisType: SequentialXAxisType;
  hiddenKeys: Set<string>;
  selectedPeriodIndices: Set<number>;
  sourceDocumentCount?: number;
}

export interface SequentialChartModel {
  chartType: ChartTypeOption;
  xAxisType: SequentialXAxisType;
  status: 'ready' | 'empty' | 'malformed';
  diagnostics: SequentialChartDiagnostic[];
  summary: SequentialResultSummary;
  chartData: SequentialAnalysisDatum[];
  axisData: SequentialAnalysisDatum[];
  xKey: 'time_period' | typeof NUMERIC_X_KEY;
  xAxis: MultiSeriesChartXAxisConfig;
  tooltip: {
    indicator: 'line' | 'dot';
    labelFormatter: (value: string | number) => string;
  };
  groups: SequentialChartGroup[];
  series: MultiSeriesChartSeries[];
  legend: ChartExportLegendItem[];
  selection: {
    selectedIndices: Set<number>;
    selectedCount: number;
    hasInvalidSelection: boolean;
  };
  counts: SequentialVisibilityCounts;
}

function buildSummary(
  parameters: SequentialChartParameters | null | undefined,
  fallbacks: SequentialResultSummaryFallbacks,
  diagnostics: SequentialChartDiagnostic[],
): SequentialResultSummary {
  const timeColumn = parameters?.time_column ?? fallbacks.timeColumn;
  let groupBy = fallbacks.groupBy;
  if (parameters?.group_by_columns) {
    const validColumns = parameters.group_by_columns.filter((column) => column.trim().length > 0);
    groupBy = Array.from(new Set(validColumns));
    if (
      validColumns.length !== parameters.group_by_columns.length ||
      groupBy.length !== validColumns.length
    ) {
      diagnostics.push({
        code: 'invalid-group-columns',
        message: 'Ignored blank or duplicate group-by columns.',
      });
    }
  }
  const columnType = parameters?.column_type ?? fallbacks.columnType;
  const numericOrigin =
    columnType === 'numeric' ? (parameters?.numeric_origin ?? fallbacks.numericOrigin) : null;
  let numericInterval =
    columnType === 'numeric' ? (parameters?.numeric_interval ?? fallbacks.numericInterval) : null;
  const rawFrequency = parameters?.frequency ?? fallbacks.frequency;
  let customIntervalValue = parameters?.custom_interval_value ?? fallbacks.customIntervalValue;
  const customIntervalUnit = parameters?.custom_interval_unit ?? fallbacks.customIntervalUnit;
  if (columnType === 'numeric' && (numericInterval === null || numericInterval <= 0)) {
    if (parameters?.numeric_interval !== undefined) {
      diagnostics.push({
        code: 'invalid-parameters',
        message: 'Result numeric interval was not a positive finite number.',
      });
    }
    numericInterval = null;
  }
  if (
    rawFrequency === 'custom' &&
    (customIntervalValue === null ||
      !Number.isInteger(customIntervalValue) ||
      customIntervalValue <= 0)
  ) {
    if (parameters?.custom_interval_value !== undefined) {
      diagnostics.push({
        code: 'invalid-parameters',
        message: 'Result custom interval was not a positive whole number.',
      });
    }
    customIntervalValue = null;
  }
  const frequencyDisplay =
    columnType === 'numeric'
      ? 'Numeric bins'
      : rawFrequency === 'custom'
        ? customIntervalValue && customIntervalUnit
          ? `Every ${String(customIntervalValue)} ${customIntervalUnit}`
          : 'Custom interval'
        : rawFrequency;
  return {
    timeColumn,
    groupBy,
    columnType,
    numericOrigin,
    numericInterval,
    rawFrequency,
    customIntervalValue,
    customIntervalUnit,
    frequencyDisplay,
  };
}

function isPeriodBoundary(value: unknown): value is string | number {
  return (
    (typeof value === 'number' && Number.isFinite(value)) ||
    (typeof value === 'string' && value.trim().length > 0)
  );
}

function periodCoordinate(value: string | number, columnType: 'datetime' | 'numeric'): number {
  if (columnType === 'numeric') {
    const numeric = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(numeric) ? numeric : Number.NaN;
  }
  return new Date(value).getTime();
}

function normalizeGroupValue(value: unknown): SequentialGroupValue | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return undefined;
}

function buildGroupIdentity(
  row: Record<string, unknown>,
  groupBy: string[],
): {
  id: string;
  label: string;
  values: Record<string, SequentialGroupValue>;
} | null {
  if (groupBy.length === 0) {
    return { id: 'sequential_count', label: 'Sequential Count', values: {} };
  }
  const values = Object.create(null) as Record<string, SequentialGroupValue>;
  const tuple: SequentialGroupValue[] = [];
  for (const column of groupBy) {
    const value = normalizeGroupValue(row[column]);
    if (value === undefined) return null;
    values[column] = value;
    tuple.push(value);
  }
  return {
    id: `series:${JSON.stringify(tuple)}`,
    label: tuple.map((value) => String(value ?? '')).join(' - '),
    values,
  };
}

function normalizeRows(
  results: SequentialAnalysisResponse | null | undefined,
  summary: SequentialResultSummary,
  diagnostics: SequentialChartDiagnostic[],
): SequentialCanonicalRow[] {
  const data = results?.data ?? [];

  const rows: SequentialCanonicalRow[] = [];
  data.forEach((row, rowIndex) => {
    if (!isPeriodBoundary(row.period_start) || !isPeriodBoundary(row.period_end)) {
      diagnostics.push({
        code: 'invalid-period',
        message: 'Ignored a row with missing period boundaries.',
        rowIndex,
      });
      return;
    }
    const startCoordinate = periodCoordinate(row.period_start, summary.columnType);
    const endCoordinate = periodCoordinate(row.period_end, summary.columnType);
    if (
      !Number.isFinite(startCoordinate) ||
      !Number.isFinite(endCoordinate) ||
      endCoordinate < startCoordinate
    ) {
      diagnostics.push({
        code: 'invalid-period',
        message: `Ignored a row whose period is invalid or inverted for ${summary.columnType} results.`,
        rowIndex,
      });
      return;
    }
    if (
      typeof row.sequential_count !== 'number' ||
      !Number.isFinite(row.sequential_count) ||
      row.sequential_count < 0
    ) {
      diagnostics.push({
        code: 'invalid-count',
        message: 'Ignored a row whose sequential count was not a non-negative finite number.',
        rowIndex,
      });
      return;
    }
    const group = buildGroupIdentity(row, summary.groupBy);
    if (!group) {
      diagnostics.push({
        code: 'invalid-group-value',
        message: 'Ignored a row with an unsupported group value.',
        rowIndex,
      });
      return;
    }
    const rawTimePeriod = isPeriodBoundary(row.time_period) ? row.time_period : null;
    let axisValue: string | number = row.period_start;
    if (summary.columnType === 'numeric') {
      if (rawTimePeriod === null || !Number.isFinite(Number(rawTimePeriod))) {
        diagnostics.push({
          code: 'invalid-period',
          message: 'Ignored a numeric row without a finite raw time-period value.',
          rowIndex,
        });
        return;
      }
      axisValue = rawTimePeriod;
    }
    const timePeriod = isPeriodBoundary(row.time_period_formatted)
      ? row.time_period_formatted
      : (rawTimePeriod ?? row.period_start);
    rows.push({
      periodKey: JSON.stringify([row.period_start, row.period_end]),
      timePeriod,
      axisValue,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      count: row.sequential_count,
      groupId: group.id,
      groupLabel: group.label,
      groupValues: group.values,
    });
  });
  return rows.sort((left, right) => {
    const leftValue = summary.columnType === 'numeric' ? left.axisValue : left.periodStart;
    const rightValue = summary.columnType === 'numeric' ? right.axisValue : right.periodStart;
    return (
      periodCoordinate(leftValue, summary.columnType) -
      periodCoordinate(rightValue, summary.columnType)
    );
  });
}

/**
 * Builds the complete render and export domain for one Sequential result.
 *
 * Used by: `SequentialAnalysisFeature`, which keeps task submission and chart
 * interaction state outside this pure boundary. Flow: validate saved params and
 * rows, normalize one canonical row representation, assign collision-safe
 * series ids, pivot/backfill/sort chart rows, build category/linear axis data,
 * and derive series, legend, visibility counts, and selection metadata from that
 * same source. Partial valid rows remain usable while diagnostics make malformed
 * payloads explicit instead of trusting casts or silent fallbacks.
 */
export function buildSequentialChartModel({
  results,
  parameters,
  fallbacks,
  chartType,
  xAxisType,
  hiddenKeys,
  selectedPeriodIndices,
  sourceDocumentCount,
}: BuildSequentialChartModelInput): SequentialChartModel {
  const diagnostics: SequentialChartDiagnostic[] = [];
  const summary = buildSummary(parameters, fallbacks, diagnostics);
  const canonicalRows = normalizeRows(results, summary, diagnostics);

  const groupsById = new Map<string, Omit<SequentialChartGroup, 'color' | 'hidden'>>();
  canonicalRows.forEach((row) => {
    groupsById.set(row.groupId, {
      id: row.groupId,
      label: row.groupLabel,
      values: row.groupValues,
    });
  });
  const groupBases = Array.from(groupsById.values()).sort((left, right) =>
    left.id.localeCompare(right.id),
  );

  const buckets = new Map<string, SequentialAnalysisDatum>();
  canonicalRows.forEach((row) => {
    const entry = buckets.get(row.periodKey) ?? {
      __period_key__: row.periodKey,
      time_period: row.timePeriod,
      __axis_value__: row.axisValue,
      period_start: row.periodStart,
      period_end: row.periodEnd,
    };
    entry[row.groupId] = Number(entry[row.groupId] ?? 0) + row.count;
    buckets.set(row.periodKey, entry);
  });
  const chartData = Array.from(buckets.values()).sort((left, right) => {
    const leftValue = summary.columnType === 'numeric' ? left.__axis_value__ : left.period_start;
    const rightValue = summary.columnType === 'numeric' ? right.__axis_value__ : right.period_start;
    return (
      periodCoordinate(leftValue as string | number, summary.columnType) -
      periodCoordinate(rightValue as string | number, summary.columnType)
    );
  });
  chartData.forEach((row) => {
    groupBases.forEach((group) => {
      if (row[group.id] === undefined) row[group.id] = 0;
    });
  });

  const groups: SequentialChartGroup[] = groupBases.map((group, index) => {
    const color = getSequentialPaletteColor(index);
    return { ...group, color, hidden: hiddenKeys.has(group.id) };
  });
  const axisData =
    xAxisType === 'number'
      ? chartData.map((row) => ({
          ...row,
          [NUMERIC_X_KEY]: periodCoordinate(
            row.__axis_value__ as string | number,
            summary.columnType,
          ),
        }))
      : chartData;
  const xAxis: MultiSeriesChartXAxisConfig =
    xAxisType === 'number'
      ? {
          type: 'number',
          domain: ['dataMin', 'dataMax'],
          tickCount: 10,
          tickFormatter: (value) => formatSequentialAxisTick(value, summary.columnType),
          angle: -45,
          height: 100,
          minTickGap: 20,
        }
      : { angle: -45, height: 100, minTickGap: 20 };
  const visibleGroups = groups.filter((group) => !group.hidden);
  const series: MultiSeriesChartSeries[] = visibleGroups.map((group) => ({
    key: group.id,
    color: group.color,
    label: group.label,
    singlePoint: chartData.length <= 1,
  }));
  const legendType = chartType === 'line' ? 'line' : chartType === 'bar' ? 'bar' : 'area';
  const legend: ChartExportLegendItem[] = groups.map((group) => ({
    label: group.label,
    color: group.color,
    type: legendType,
    hidden: group.hidden,
  }));

  const orderedSelection = Array.from(selectedPeriodIndices).sort((left, right) => left - right);
  const validSelectedEntries = orderedSelection
    .map((index) => ({ index, row: chartData[index] }))
    .filter((entry): entry is { index: number; row: SequentialAnalysisDatum } =>
      Boolean(entry.row),
    );
  const hasInvalidSelection = validSelectedEntries.length !== orderedSelection.length;
  const selectedChartRows = validSelectedEntries.map((entry) => entry.row);
  const validSelectedIndices = new Set(validSelectedEntries.map((entry) => entry.index));
  const selectedPeriodKeys = new Set(
    selectedChartRows.map((row) =>
      typeof row.__period_key__ === 'string' ? row.__period_key__ : '',
    ),
  );
  const shownRows = canonicalRows.filter((row) => !hiddenKeys.has(row.groupId));
  const chosenRows = shownRows.filter((row) => selectedPeriodKeys.has(row.periodKey));
  const sumCounts = (rows: SequentialCanonicalRow[]) =>
    rows.reduce((total, row) => total + row.count, 0);
  const hasValidSourceDocumentCount =
    typeof sourceDocumentCount === 'number' &&
    Number.isFinite(sourceDocumentCount) &&
    Number.isInteger(sourceDocumentCount) &&
    sourceDocumentCount >= 0;
  if (sourceDocumentCount !== undefined && !hasValidSourceDocumentCount) {
    diagnostics.push({
      code: 'invalid-count',
      message: 'Source document count was not a non-negative whole number.',
    });
  }
  const counts: SequentialVisibilityCounts = {
    totalPointCount: canonicalRows.length,
    totalDocumentCount: hasValidSourceDocumentCount
      ? sourceDocumentCount
      : sumCounts(canonicalRows),
    shownPointCount: shownRows.length,
    shownDocumentCount: sumCounts(shownRows),
    chosenPointCount: validSelectedIndices.size > 0 ? chosenRows.length : 0,
    chosenDocumentCount: validSelectedIndices.size > 0 ? sumCounts(chosenRows) : 0,
  };
  return {
    chartType,
    xAxisType,
    status: diagnostics.length > 0 ? 'malformed' : canonicalRows.length > 0 ? 'ready' : 'empty',
    diagnostics,
    summary,
    chartData,
    axisData,
    xKey: xAxisType === 'number' ? NUMERIC_X_KEY : 'time_period',
    xAxis,
    tooltip: {
      indicator: chartType === 'line' ? 'line' : 'dot',
      labelFormatter:
        xAxisType === 'number'
          ? (value) => formatSequentialAxisTick(value, summary.columnType)
          : summary.columnType === 'datetime'
            ? formatSequentialTimeLabel
            : (value) => String(value),
    },
    groups,
    series,
    legend,
    selection: {
      selectedIndices: validSelectedIndices,
      selectedCount: validSelectedIndices.size,
      hasInvalidSelection,
    },
    counts,
  };
}
