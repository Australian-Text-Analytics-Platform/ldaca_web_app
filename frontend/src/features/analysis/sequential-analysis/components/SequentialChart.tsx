import React, { useMemo } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DisabledReasonTooltip } from '@/components/ui/disabled-reason-tooltip';
import type { ChartConfig } from '@/components/ui/chart';
import {
  MultiSeriesChart,
  type MultiSeriesChartSeries,
  type MultiSeriesChartXAxisConfig,
} from '@/features/analysis/common/components/MultiSeriesChart';
import { acceptPlaceholderOnTab } from '@/features/preprocessing/utils/placeholderTabFill';
import type {
  SequentialAnalysisDatum,
  ChartTypeOption,
} from '../hooks/useSequentialAnalysisTaskFlow';
import {
  getPaletteColor,
  formatTimeLabel,
} from '../hooks/useSequentialAnalysisTaskFlow';

export type SequentialXAxisType = 'category' | 'number';

// Numeric x values derived from period_start: datetime columns produce
// epoch-ms timestamps (≥ ~10^11 for any plausible year), while numeric
// columns produce ordinary integers. Use the magnitude to decide whether
// to format as a date or a raw number.
const TIMESTAMP_HEURISTIC_THRESHOLD = 1e11;

const NUMERIC_X_KEY = '__x_numeric__';

const toNumericX = (row: SequentialAnalysisDatum): number => {
  const raw = row.period_start ?? row.time_period;
  if (typeof raw === 'number') return raw;
  if (raw == null) return Number.NaN;
  const parsed = new Date(String(raw)).getTime();
  if (!Number.isNaN(parsed)) return parsed;
  const asNumber = Number(raw);
  return Number.isNaN(asNumber) ? Number.NaN : asNumber;
};

const formatNumericTick = (value: unknown): string => {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '';
  if (Math.abs(n) >= TIMESTAMP_HEURISTIC_THRESHOLD) {
    return formatTimeLabel(n);
  }
  return String(n);
};

interface SequentialChartProps {
  chartType: ChartTypeOption;
  xAxisType?: SequentialXAxisType;
  chartData: SequentialAnalysisDatum[];
  chartConfig: ChartConfig;
  groupKeys: string[];
  groupPointCounts: Record<string, number>;
  hiddenKeys: Set<string>;
  selectedPeriodIndices: Set<number>;
  canDetach: boolean;
  isDetaching: boolean;
  onToggleKey: (key: string) => void;
  onPeriodClick: (index: number, shiftHeld: boolean) => void;
  onClearSelection: () => void;
  detachNodeName: string;
  detachNodeNamePlaceholder: string;
  onDetachNodeNameChange: (value: string) => void;
  onDetach: () => void;
  containerRef?: React.RefObject<HTMLDivElement | null>;
}

const CHART_HEIGHT_PX = 400;

export const SequentialChart: React.FC<SequentialChartProps> = ({
  chartType,
  xAxisType = 'category',
  chartData,
  chartConfig,
  groupKeys,
  groupPointCounts,
  hiddenKeys,
  selectedPeriodIndices,
  canDetach,
  isDetaching,
  onToggleKey,
  onPeriodClick,
  onClearSelection,
  detachNodeName,
  detachNodeNamePlaceholder,
  onDetachNodeNameChange,
  onDetach,
  containerRef,
}) => {
  const toggleKey = onToggleKey;
  const visibleKeys = groupKeys.filter((key) => !hiddenKeys.has(key));
  const hasSelection = selectedPeriodIndices.size > 0;
  const useNumericAxis = xAxisType === 'number';
  const chartDataForAxis = useMemo(() => {
    if (!useNumericAxis) return chartData;
    return chartData.map((row) => ({ ...row, [NUMERIC_X_KEY]: toNumericX(row) }));
  }, [useNumericAxis, chartData]);

  if (!groupKeys.length) {
    return (
      <div ref={containerRef}>
        <div className="flex h-40 items-center justify-center rounded-md border border-dashed border-muted-foreground/30 text-sm text-muted-foreground">
          No groups meet the current minimum group size.
        </div>
        <div className="mt-4 flex flex-col gap-3 px-4 pb-2 sm:flex-row sm:items-center sm:justify-between">
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto"
            disabled={!hasSelection || isDetaching}
            onClick={onClearSelection}
          >
            Clear Selection
          </Button>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-[22rem] sm:flex-row sm:items-center sm:justify-end">
            <div className="flex w-full items-center gap-2 sm:max-w-md">
              <label
                className="shrink-0 text-sm font-medium text-muted-foreground"
                htmlFor="sequential-new-node-name"
              >
                New data block name
              </label>
              <Input
                id="sequential-new-node-name"
                value={detachNodeName}
                onChange={(event) => onDetachNodeNameChange(event.target.value)}
                onKeyDown={(event) =>
                  acceptPlaceholderOnTab({
                    event,
                    value: detachNodeName,
                    setValue: onDetachNodeNameChange,
                  })
                }
                placeholder={detachNodeNamePlaceholder}
                disabled={isDetaching}
                aria-label="New data block name"
                className="min-w-0 flex-1"
              />
            </div>
            <DisabledReasonTooltip reason="No groups meet the current minimum group size — adjust the filter to enable selecting periods.">
              <Button
                type="button"
                size="sm"
                className="w-full sm:w-auto"
                disabled
                onClick={onDetach}
              >
                <Plus className="mr-2 h-4 w-4" />
                Add to Workspace ({selectedPeriodIndices.size})
              </Button>
            </DisabledReasonTooltip>
          </div>
        </div>
      </div>
    );
  }

  if (!chartData.length) {
    return (
      <div className="flex h-40 items-center justify-center rounded-md border border-dashed border-muted-foreground/30 text-sm text-muted-foreground">
        No sequential analysis data available. Adjust your configuration and try again.
      </div>
    );
  }

  const series: MultiSeriesChartSeries[] = visibleKeys.map((key, idx) => {
    const color = String(chartConfig[key]?.color ?? getPaletteColor(idx));
    const label = (chartConfig[key]?.label as string | undefined) ?? key;
    return {
      key,
      color,
      label,
      singlePoint: (groupPointCounts[key] ?? chartData.length) <= 1,
    };
  });

  const xKey = useNumericAxis ? NUMERIC_X_KEY : 'time_period';
  const xAxisConfig: MultiSeriesChartXAxisConfig = useNumericAxis
    ? {
        type: 'number',
        domain: ['dataMin', 'dataMax'],
        tickFormatter: formatNumericTick as never,
        angle: -45,
        height: 100,
        minTickGap: 20,
      }
    : { angle: -45, height: 100, minTickGap: 20 };

  return (
    <div ref={containerRef}>
      <MultiSeriesChart
        data={chartDataForAxis}
        xKey={xKey}
        series={series}
        chartType={chartType}
        xAxis={xAxisConfig}
        margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
        height={CHART_HEIGHT_PX}
        tooltip={{
          shadcn: true,
          className: 'min-w-50',
          indicator: chartType === 'line' ? 'line' : 'dot',
          labelFormatter: (useNumericAxis ? formatNumericTick : formatTimeLabel) as never,
        }}
        selection={{
          selectedIndices: selectedPeriodIndices,
          onSelect: onPeriodClick,
        }}
        interactive
      />
      <div className="mt-4 flex flex-wrap items-center justify-center gap-4 px-4">
        {groupKeys.map((key) => {
          const color = String(chartConfig[key]?.color ?? '#8884d8');
          const label = chartConfig[key]?.label || key;
          const isHidden = hiddenKeys.has(key);
          return (
            <button
              key={key}
              type="button"
              className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 transition-opacity hover:bg-muted/60"
              style={{ opacity: isHidden ? 0.4 : 1 }}
              onClick={() => toggleKey(key)}
              aria-pressed={!isHidden}
              aria-label={isHidden ? `Show ${label}` : `Hide ${label}`}
            >
              {chartType === 'line' ? (
                <div className="flex items-center">
                  <div className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                  <div className="h-0.5 w-3" style={{ backgroundColor: color }} />
                  <div className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                </div>
              ) : (
                <div className="h-3 w-3 rounded-sm" style={{ backgroundColor: color }} />
              )}
              <span
                className="text-sm font-medium text-muted-foreground"
                style={{ textDecoration: isHidden ? 'line-through' : 'none' }}
              >
                {label}
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-4 flex flex-col gap-3 px-4 pb-2 sm:flex-row sm:items-end sm:justify-between">
        <Button
          type="button"
          variant="outline"
          className="w-full sm:w-auto"
          disabled={!hasSelection || isDetaching}
          onClick={onClearSelection}
        >
          Clear Selection
        </Button>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-[22rem] sm:flex-row sm:items-center sm:justify-end">
          <div className="flex w-full items-center gap-2 sm:max-w-md">
            <label
              className="shrink-0 text-sm font-medium text-muted-foreground"
              htmlFor="sequential-new-node-name"
            >
              New data block name
            </label>
            <Input
              id="sequential-new-node-name"
              value={detachNodeName}
              onChange={(event) => onDetachNodeNameChange(event.target.value)}
              onKeyDown={(event) =>
                acceptPlaceholderOnTab({
                  event,
                  value: detachNodeName,
                  setValue: onDetachNodeNameChange,
                })
              }
              placeholder={detachNodeNamePlaceholder}
              disabled={isDetaching}
              aria-label="New data block name"
              className="min-w-0 flex-1"
            />
          </div>
          <DisabledReasonTooltip
            reason={
              isDetaching
                ? undefined
                : !canDetach
                  ? 'Click periods on the chart (shift-click to extend) to pick a subset to add as a new data block.'
                  : undefined
            }
          >
            <Button
              type="button"
              size="sm"
              className="w-full sm:w-auto"
              disabled={!canDetach || isDetaching}
              onClick={onDetach}
            >
              {isDetaching ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Adding...
                </>
              ) : (
                <>
                  <Plus className="mr-2 h-4 w-4" />
                  Add to Workspace ({selectedPeriodIndices.size})
                </>
              )}
            </Button>
          </DisabledReasonTooltip>
        </div>
      </div>
    </div>
  );
};
