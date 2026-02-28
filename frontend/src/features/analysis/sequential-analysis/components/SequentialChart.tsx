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
} from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '../../../../components/ui/chart';
import type { ChartConfig } from '../../../../components/ui/chart';
import type { SequentialAnalysisDatum, ChartTypeOption } from '../hooks/useSequentialAnalysisTaskFlow';
import { getPaletteColor, formatTimeLabel } from '../hooks/useSequentialAnalysisTaskFlow';

interface SequentialChartProps {
  chartType: ChartTypeOption;
  chartData: SequentialAnalysisDatum[];
  chartConfig: ChartConfig;
  groupKeys: string[];
  groupPointCounts: Record<string, number>;
}

export const SequentialChart: React.FC<SequentialChartProps> = ({
  chartType,
  chartData,
  chartConfig,
  groupKeys,
  groupPointCounts,
}) => {
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
    <ChartContainer config={chartConfig} className="w-full">
      <div className="aspect-auto h-100 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {chartType === 'bar' ? (
            <BarChart data={chartData} margin={margin}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time_period" {...axisTickProps} />
              <YAxis />
              <ChartTooltip
                content={<ChartTooltipContent className="min-w-50" labelFormatter={formatTimeLabel} />}
              />
              {groupKeys.map((key, idx) => {
                const color = chartConfig[key]?.color ?? getPaletteColor(idx);
                return <Bar key={key} dataKey={key} fill={color} radius={[6, 6, 0, 0]} name={key} />;
              })}
            </BarChart>
          ) : chartType === 'area' ? (
            <AreaChart data={chartData} margin={margin}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time_period" {...axisTickProps} />
              <YAxis />
              <ChartTooltip
                content={<ChartTooltipContent className="min-w-50" labelFormatter={formatTimeLabel} />}
              />
              {groupKeys.map((key, idx) => {
                const color = chartConfig[key]?.color ?? getPaletteColor(idx);
                return (
                  <Area
                    key={key}
                    type="monotone"
                    dataKey={key}
                    stackId="1"
                    stroke={color}
                    fill={color}
                    fillOpacity={0.35}
                    name={key}
                  />
                );
              })}
            </AreaChart>
          ) : (
            <LineChart data={chartData} margin={margin}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time_period" {...axisTickProps} />
              <YAxis />
              <ChartTooltip
                content={
                  <ChartTooltipContent className="min-w-50" indicator="line" labelFormatter={formatTimeLabel} />
                }
              />
              {groupKeys.map((key, idx) => {
                const color = chartConfig[key]?.color ?? getPaletteColor(idx);
                const shouldShowDot = (groupPointCounts[key] ?? chartData.length) <= 1;
                return (
                  <Line
                    key={key}
                    type="monotone"
                    dataKey={key}
                    stroke={color}
                    strokeWidth={2}
                    dot={shouldShowDot ? { r: 4, strokeWidth: 0 } : false}
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
          const color = chartConfig[key]?.color;
          const label = chartConfig[key]?.label || key;
          return (
            <div key={key} className="flex items-center gap-2">
              {chartType === 'line' ? (
                <div className="flex items-center">
                  <div className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                  <div className="h-0.5 w-3" style={{ backgroundColor: color }} />
                  <div className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                </div>
              ) : (
                <div className="h-3 w-3 rounded-sm" style={{ backgroundColor: color }} />
              )}
              <span className="text-sm font-medium text-muted-foreground">{label}</span>
            </div>
          );
        })}
      </div>
    </ChartContainer>
  );
};
