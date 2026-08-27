import React from 'react';

import { Button } from '@/components/ui/button';
import { MultiSeriesChart } from '@/features/views/common/components/MultiSeriesChart';
import { FilterableSeriesLegend } from '@/features/views/common/components/FilterableSeriesLegend';
import type { SequentialChartModel } from '../hooks/sequentialChartModel';

interface SequentialChartProps {
  model: SequentialChartModel;
  onToggleKey: (key: string) => void;
  onPeriodClick: (index: number, shiftHeld: boolean) => void;
  onPeriodRangeSelect: (startIndex: number, endIndex: number, shiftHeld: boolean) => void;
  onClearSelection: () => void;
  dataResetKey: string;
  toolbarStart?: React.ReactNode;
  containerRef?: React.RefObject<HTMLDivElement | null>;
}

const CHART_HEIGHT_PX = 400;

/**
 * Renders the chart and interaction controls from a canonical Sequential model.
 *
 * Rendered by: `SequentialAnalysisResultsPanel`. The pure model already owns
 * row/axis/series/legend shaping; this component only binds ECharts selection,
 * legend clicks, resize container identity, and chart selection controls.
 */
export function SequentialChart({
  model,
  onToggleKey,
  onPeriodClick,
  onPeriodRangeSelect,
  onClearSelection,
  dataResetKey,
  toolbarStart,
  containerRef,
}: SequentialChartProps) {
  // A refreshed result can invalidate indices held by the interaction hook.
  // Keep Clear enabled for that stale state even though the model deliberately
  // excludes invalid indices from rendering.
  const hasSelection = model.selection.selectedCount > 0 || model.selection.hasInvalidSelection;
  if (!model.chartData.length) {
    return (
      <div className="flex h-40 items-center justify-center rounded-md border border-dashed border-surface-border-foreground/30 text-body text-description">
        {model.status === 'malformed'
          ? 'The sequential analysis result is malformed and has no chartable rows.'
          : 'No sequential analysis data available. Adjust your configuration and try again.'}
      </div>
    );
  }

  return (
    <div ref={containerRef}>
      {model.status === 'malformed' ? (
        <div className="mb-3 rounded-md border border-warning bg-warning-background px-3 py-2 text-body text-foreground">
          Some malformed result rows were ignored ({String(model.diagnostics.length)} issue
          {model.diagnostics.length === 1 ? '' : 's'}).
        </div>
      ) : null}
      <MultiSeriesChart
        data={model.axisData}
        xKey={model.xKey}
        series={model.series}
        chartType={model.chartType}
        xAxis={model.xAxis}
        height={CHART_HEIGHT_PX}
        tooltip={{
          labelFormatter: model.tooltip.labelFormatter,
        }}
        selection={{
          selectedIndices: model.selection.selectedIndices,
          onSelect: onPeriodClick,
          onSelectRange: onPeriodRangeSelect,
        }}
        ariaLabel="Trends and Sequence chart"
        dataResetKey={`${dataResetKey}:${model.chartData
          .map((row) => (typeof row.__period_key__ === 'string' ? row.__period_key__ : ''))
          .join('|')}`}
        toolbarStart={toolbarStart}
      />
      <FilterableSeriesLegend
        items={model.groups.map((group) => ({
          key: group.id,
          color: group.color,
          text: group.legendText,
          label: group.label,
          hidden: group.hidden,
          marker: model.chartType === 'bar' ? 'bar' : model.chartType,
        }))}
        onToggle={onToggleKey}
        ariaLabel="Trends groups"
        className="mt-4 flex flex-wrap items-center justify-center gap-4 px-4 text-body font-medium text-description"
      />
      <div className="mt-4 flex justify-end px-4 pb-2">
        <Button
          type="button"
          variant="outline"
          className="w-full sm:w-auto"
          disabled={!hasSelection}
          onClick={onClearSelection}
        >
          Clear Selection
        </Button>
      </div>
    </div>
  );
}
