import React from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  BarChart,
  Bar,
  AreaChart,
  Area,
  Cell,
} from 'recharts';
import { Loader2, Plus } from 'lucide-react';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '../../../../components/ui/chart';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import type { ChartConfig } from '../../../../components/ui/chart';
import { acceptPlaceholderOnTab } from '../../../preprocessing/utils/placeholderTabFill';
import type { SequentialAnalysisDatum, ChartTypeOption } from '../hooks/useSequentialAnalysisTaskFlow';
import { getPaletteColor, formatTimeLabel } from '../hooks/useSequentialAnalysisTaskFlow';

interface SequentialChartProps {
  chartType: ChartTypeOption;
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

interface SequentialDotProps {
  cx?: number;
  cy?: number;
  index?: number;
}

export const SequentialChart: React.FC<SequentialChartProps> = ({
  chartType,
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
                onKeyDown={(event) => acceptPlaceholderOnTab({ event, value: detachNodeName, setValue: onDetachNodeNameChange })}
                placeholder={detachNodeNamePlaceholder}
                disabled={isDetaching}
                aria-label="New data block name"
                className="min-w-0 flex-1"
              />
            </div>
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
          </div>
        </div>
      </div>
    );
  }

  const handleChartClick = (activeTooltipIndex: unknown, shiftHeld: boolean) => {
    if (typeof activeTooltipIndex === 'number') {
      onPeriodClick(activeTooltipIndex, shiftHeld);
      return;
    }

    if (typeof activeTooltipIndex === 'string') {
      const parsedIndex = Number(activeTooltipIndex);
      if (Number.isInteger(parsedIndex)) {
        onPeriodClick(parsedIndex, shiftHeld);
      }
    }
  };

  const renderDot = (color: string, shouldShowDot: boolean) => (props: SequentialDotProps) => {
    const { cx, cy, index } = props;
    if (typeof cx !== 'number' || typeof cy !== 'number' || typeof index !== 'number') {
      return null;
    }

    if (!hasSelection) {
      return shouldShowDot ? <circle cx={cx} cy={cy} r={4} fill={color} /> : null;
    }

    if (selectedPeriodIndices.has(index)) {
      return <circle cx={cx} cy={cy} r={5} fill={color} stroke="white" strokeWidth={1.5} />;
    }

    return <circle cx={cx} cy={cy} r={3} fill={color} fillOpacity={0.25} />;
  };

  if (!chartData.length) {
    return (
      <div className="flex h-40 items-center justify-center rounded-md border border-dashed border-muted-foreground/30 text-sm text-muted-foreground">
        No sequential analysis data available. Adjust your configuration and try again.
      </div>
    );
  }

  const margin = { top: 20, right: 30, left: 20, bottom: 20 };
  const axisTickProps = {
    angle: -45,
    textAnchor: 'end' as const,
    height: 100,
    minTickGap: 20,
  };

  return (
    <div ref={containerRef}>
      <ChartContainer config={chartConfig} className={chartData.length ? 'w-full cursor-pointer' : 'w-full'}>
        <div className="aspect-auto h-100 w-full">
          <ResponsiveContainer width="100%" height="100%">
            {chartType === 'bar' ? (
              <BarChart
                data={chartData}
                margin={margin}
                onClick={(nextState, event) => {
                  handleChartClick(nextState?.activeTooltipIndex, event.shiftKey);
                }}
              >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time_period" {...axisTickProps} />
              <YAxis />
              <ChartTooltip
                content={<ChartTooltipContent className="min-w-50" labelFormatter={formatTimeLabel} />}
              />
              {visibleKeys.map((key, idx) => {
                const color = String(chartConfig[key]?.color ?? getPaletteColor(idx));
                return (
                  <Bar key={key} dataKey={key} fill={color} radius={[6, 6, 0, 0]} name={key}>
                    {chartData.map((_, pointIdx) => (
                      <Cell
                        key={`${key}-${pointIdx}`}
                        fillOpacity={
                          !hasSelection || selectedPeriodIndices.has(pointIdx) ? 1 : 0.25
                        }
                      />
                    ))}
                  </Bar>
                );
              })}
              </BarChart>
            ) : chartType === 'area' ? (
              <AreaChart
                data={chartData}
                margin={margin}
                onClick={(nextState, event) => {
                  handleChartClick(nextState?.activeTooltipIndex, event.shiftKey);
                }}
              >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time_period" {...axisTickProps} />
              <YAxis />
              <ChartTooltip
                content={<ChartTooltipContent className="min-w-50" labelFormatter={formatTimeLabel} />}
              />
              {visibleKeys.map((key, idx) => {
                const color = String(chartConfig[key]?.color ?? getPaletteColor(idx));
                return (
                  <Area
                    key={key}
                    type="monotone"
                    dataKey={key}
                    stackId="1"
                    stroke={color}
                    fill={color}
                    fillOpacity={hasSelection ? 0.2 : 0.35}
                    dot={renderDot(color, (groupPointCounts[key] ?? chartData.length) <= 1)}
                    activeDot={{ r: 5 }}
                    name={key}
                  />
                );
              })}
              </AreaChart>
            ) : (
              <LineChart
                data={chartData}
                margin={margin}
                onClick={(nextState, event) => {
                  handleChartClick(nextState?.activeTooltipIndex, event.shiftKey);
                }}
              >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time_period" {...axisTickProps} />
              <YAxis />
              <ChartTooltip
                content={
                  <ChartTooltipContent className="min-w-50" indicator="line" labelFormatter={formatTimeLabel} />
                }
              />
              {visibleKeys.map((key, idx) => {
                const color = String(chartConfig[key]?.color ?? getPaletteColor(idx));
                const shouldShowDot = (groupPointCounts[key] ?? chartData.length) <= 1;
                return (
                  <Line
                    key={key}
                    type="monotone"
                    dataKey={key}
                    stroke={color}
                    strokeWidth={2}
                    dot={renderDot(color, shouldShowDot)}
                    activeDot={{ r: 5 }}
                    name={key}
                  />
                );
              })}
              </LineChart>
            )}
          </ResponsiveContainer>
        </div>
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
                onKeyDown={(event) => acceptPlaceholderOnTab({ event, value: detachNodeName, setValue: onDetachNodeNameChange })}
                placeholder={detachNodeNamePlaceholder}
                disabled={isDetaching}
                aria-label="New data block name"
                className="min-w-0 flex-1"
              />
            </div>
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
          </div>
        </div>
      </ChartContainer>
    </div>
  );
};
