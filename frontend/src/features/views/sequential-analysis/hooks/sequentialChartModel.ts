import type { SequentialAnalysisRequest, SequentialAnalysisResponse } from '@/api';
import type { MultiSeriesChartSeries } from '@/features/views/common/components/MultiSeriesChart';
import type { ChartExportLegendItem } from '@/lib/chartExport';
import type { XAxisComponentOption } from 'echarts/types/dist/option';

type SequentialAnalysisDatum = Record<string, unknown>;
export type ChartTypeOption = 'line' | 'bar' | 'area';
export type SequentialXAxisType = 'category' | 'number';
type SequentialFrequency = NonNullable<SequentialAnalysisRequest['frequency']>;
type SequentialCustomIntervalUnit = NonNullable<SequentialAnalysisRequest['custom_interval_unit']>;

const NUMERIC_X_KEY = '__x_numeric__';
const CATEGORY_X_KEY = '__period_key__';

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
    | 'invalid-result-index'
    | 'invalid-parameters';
  message: string;
  rowIndex?: number;
}

type SequentialGroupValue = string | number | boolean | null;

interface SequentialCanonicalRow {
  periodIndex: number;
  periodKey: string;
  timePeriod: string | number;
  axisValue: string | number;
  periodStart: string | number;
  periodEnd: string | number;
  count: number;
  groupId: string;
  groupIndex: number;
  groupLabel: string;
  groupValues: Record<string, SequentialGroupValue>;
}

interface SequentialChartGroup {
  id: string;
  index: number;
  label: string;
  color: string;
  hidden: boolean;
  values: Record<string, SequentialGroupValue>;
  totalCount: number;
  selectedCount: number;
  legendText: string;
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
}

export interface SequentialChartModel {
  chartType: ChartTypeOption;
  xAxisType: SequentialXAxisType;
  status: 'ready' | 'empty' | 'malformed';
  diagnostics: SequentialChartDiagnostic[];
  summary: SequentialResultSummary;
  chartData: SequentialAnalysisDatum[];
  axisData: SequentialAnalysisDatum[];
  xKey: typeof CATEGORY_X_KEY | typeof NUMERIC_X_KEY;
  xAxis: XAxisComponentOption;
  tooltip: {
    labelFormatter: (value: string | number) => string;
  };
  groups: SequentialChartGroup[];
  series: MultiSeriesChartSeries[];
  legend: ChartExportLegendItem[];
  selection: {
    selectedIndices: Set<number>;
    selectedCount: number;
    hasInvalidSelection: boolean;
    selectedPeriodIds: number[];
  };
  excludedGroupIndices: number[];
  eligibleDocumentCount: number;
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
  index: number;
  label: string;
  values: Record<string, SequentialGroupValue>;
} | null {
  const groupIndex = row.group_index;
  if (!Number.isInteger(groupIndex) || Number(groupIndex) < 0) return null;
  if (groupBy.length === 0) {
    return {
      id: `group:${String(groupIndex)}`,
      index: Number(groupIndex),
      label: 'Sequential Count',
      values: {},
    };
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
    id: `group:${String(groupIndex)}`,
    index: Number(groupIndex),
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
    if (!Number.isInteger(row.period_index) || Number(row.period_index) < 0) {
      diagnostics.push({
        code: 'invalid-result-index',
        message: 'Ignored a row without a valid period index.',
        rowIndex,
      });
      return;
    }
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
    if (
      rawTimePeriod === null ||
      !Number.isFinite(periodCoordinate(rawTimePeriod, summary.columnType))
    ) {
      diagnostics.push({
        code: 'invalid-period',
        message: 'Ignored a row without a valid raw time-period value.',
        rowIndex,
      });
      return;
    }
    const timePeriod = isPeriodBoundary(row.time_period_formatted)
      ? row.time_period_formatted
      : rawTimePeriod;
    rows.push({
      periodIndex: Number(row.period_index),
      periodKey: String(row.period_index),
      timePeriod,
      axisValue: rawTimePeriod,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      count: row.sequential_count,
      groupId: group.id,
      groupIndex: group.index,
      groupLabel: group.label,
      groupValues: group.values,
    });
  });
  return rows.sort((left, right) => {
    return (
      periodCoordinate(left.axisValue, summary.columnType) -
      periodCoordinate(right.axisValue, summary.columnType)
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
}: BuildSequentialChartModelInput): SequentialChartModel {
  const diagnostics: SequentialChartDiagnostic[] = [];
  const summary = buildSummary(parameters, fallbacks, diagnostics);
  const canonicalRows = normalizeRows(results, summary, diagnostics);

  const groupsById = new Map<
    string,
    Pick<SequentialChartGroup, 'id' | 'index' | 'label' | 'values'>
  >();
  canonicalRows.forEach((row) => {
    groupsById.set(row.groupId, {
      id: row.groupId,
      index: row.groupIndex,
      label: row.groupLabel,
      values: row.groupValues,
    });
  });
  const groupBases = Array.from(groupsById.values()).sort(
    (left, right) => left.index - right.index,
  );

  const buckets = new Map<string, SequentialAnalysisDatum>();
  canonicalRows.forEach((row) => {
    const existing = buckets.get(row.periodKey);
    const entry = existing ?? {
      [CATEGORY_X_KEY]: row.periodKey,
      __period_index__: row.periodIndex,
      time_period: row.timePeriod,
      __axis_value__: row.axisValue,
      period_start: row.periodStart,
      period_end: row.periodEnd,
    };
    entry[row.groupId] = Number(entry[row.groupId] ?? 0) + row.count;
    if (existing) {
      if (
        periodCoordinate(row.periodStart, summary.columnType) <
        periodCoordinate(existing.period_start as string | number, summary.columnType)
      ) {
        entry.period_start = row.periodStart;
      }
      if (
        periodCoordinate(row.periodEnd, summary.columnType) >
        periodCoordinate(existing.period_end as string | number, summary.columnType)
      ) {
        entry.period_end = row.periodEnd;
      }
    }
    buckets.set(row.periodKey, entry);
  });
  const chartData = Array.from(buckets.values()).sort((left, right) => {
    return Number(left.__period_index__) - Number(right.__period_index__);
  });
  chartData.forEach((row) => {
    groupBases.forEach((group) => {
      if (row[group.id] === undefined) row[group.id] = 0;
    });
  });
  const categoryLabelsByKey = new Map<string, string | number>();
  chartData.forEach((row) => {
    const key = row[CATEGORY_X_KEY];
    const label = row.time_period;
    if (typeof key === 'string' && isPeriodBoundary(label)) {
      categoryLabelsByKey.set(key, label);
    }
  });
  const categoryLabelFor = (value: unknown): string | number => {
    if (typeof value === 'string') {
      const label = categoryLabelsByKey.get(value);
      if (label !== undefined) return label;
    }
    return isPeriodBoundary(value) ? value : '';
  };

  const orderedSelection = Array.from(selectedPeriodIndices).sort((left, right) => left - right);
  const validSelectedEntries = orderedSelection
    .map((index) => ({ index, row: chartData[index] }))
    .filter((entry): entry is { index: number; row: SequentialAnalysisDatum } =>
      Boolean(entry.row),
    );
  const hasInvalidSelection = validSelectedEntries.length !== orderedSelection.length;
  const validSelectedIndices = new Set(validSelectedEntries.map((entry) => entry.index));
  const selectedPeriodIds = validSelectedEntries.map((entry) => Number(entry.row.__period_index__));
  const selectedPeriodIdSet = new Set(selectedPeriodIds);
  const sumCounts = (rows: SequentialCanonicalRow[]) =>
    rows.reduce((total, row) => total + row.count, 0);
  const groupTotals = new Map<number, number>();
  const selectedGroupTotals = new Map<number, number>();
  canonicalRows.forEach((row) => {
    groupTotals.set(row.groupIndex, (groupTotals.get(row.groupIndex) ?? 0) + row.count);
    if (selectedPeriodIdSet.has(row.periodIndex)) {
      selectedGroupTotals.set(
        row.groupIndex,
        (selectedGroupTotals.get(row.groupIndex) ?? 0) + row.count,
      );
    }
  });
  const visibleTotal = groupBases.reduce(
    (total, group) =>
      hiddenKeys.has(group.id) ? total : total + (groupTotals.get(group.index) ?? 0),
    0,
  );
  const groups: SequentialChartGroup[] = groupBases.map((group, index) => {
    const color = getSequentialPaletteColor(index);
    const hidden = hiddenKeys.has(group.id);
    const totalCount = groupTotals.get(group.index) ?? 0;
    const selectedCount = selectedGroupTotals.get(group.index) ?? 0;
    const countText =
      validSelectedIndices.size > 0
        ? `${String(selectedCount)}/${String(totalCount)}`
        : String(totalCount);
    const detail = hidden
      ? `${countText} · Hidden`
      : `${countText} · ${visibleTotal > 0 ? ((totalCount / visibleTotal) * 100).toFixed(1) : '0.0'}%`;
    return {
      ...group,
      color,
      hidden,
      totalCount,
      selectedCount,
      legendText: `${group.label} (${detail})`,
    };
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
  const xAxis: XAxisComponentOption =
    xAxisType === 'number'
      ? {
          type: 'value',
          min: 'dataMin',
          max: 'dataMax',
          splitNumber: 10,
          axisLabel: {
            formatter: (value) => formatSequentialAxisTick(value, summary.columnType),
            rotate: 45,
          },
        }
      : {
          type: 'category',
          axisLabel: {
            formatter: (value) => String(categoryLabelFor(value)),
            rotate: 45,
          },
        };
  const visibleGroups = groups.filter((group) => !group.hidden);
  const series: MultiSeriesChartSeries[] = visibleGroups.map((group) => ({
    key: group.id,
    color: group.color,
    label: group.label,
  }));
  const legendType = chartType === 'line' ? 'line' : chartType === 'bar' ? 'bar' : 'area';
  const legend: ChartExportLegendItem[] = groups.map((group) => ({
    label: group.legendText,
    color: group.color,
    type: legendType,
    hidden: group.hidden,
  }));

  const shownRows = canonicalRows.filter((row) => !hiddenKeys.has(row.groupId));
  const chosenRows = shownRows.filter((row) => selectedPeriodIdSet.has(row.periodIndex));
  const counts: SequentialVisibilityCounts = {
    totalPointCount: canonicalRows.length,
    totalDocumentCount: sumCounts(canonicalRows),
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
    xKey: xAxisType === 'number' ? NUMERIC_X_KEY : CATEGORY_X_KEY,
    xAxis,
    tooltip: {
      labelFormatter:
        xAxisType === 'number'
          ? (value) => formatSequentialAxisTick(value, summary.columnType)
          : (value) => {
              const label = categoryLabelFor(value);
              return summary.columnType === 'datetime'
                ? formatSequentialTimeLabel(label)
                : String(label);
            },
    },
    groups,
    series,
    legend,
    selection: {
      selectedIndices: validSelectedIndices,
      selectedCount: validSelectedIndices.size,
      hasInvalidSelection,
      selectedPeriodIds,
    },
    excludedGroupIndices: groups.filter((group) => group.hidden).map((group) => group.index),
    eligibleDocumentCount:
      validSelectedIndices.size > 0 ? sumCounts(chosenRows) : sumCounts(shownRows),
    counts,
  };
}
