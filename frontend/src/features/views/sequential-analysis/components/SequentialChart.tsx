import React from 'react';

import { Button } from '@/components/ui/button';
import { MultiSeriesChart } from '@/features/views/common/components/MultiSeriesChart';
import type { SequentialChartModel } from '../hooks/sequentialChartModel';

interface SequentialChartProps {
  model: SequentialChartModel;
  onToggleKey: (key: string) => void;
  onPeriodClick: (index: number, shiftHeld: boolean) => void;
  onClearSelection: () => void;
  containerRef?: React.RefObject<HTMLDivElement | null>;
}

const CHART_HEIGHT_PX = 400;

/**
 * Renders the chart and interaction controls from a canonical Sequential model.
 *
 * Rendered by: `SequentialAnalysisResultsPanel`. The pure model already owns
 * row/axis/series/legend shaping; this component only binds Recharts selection,
 * legend clicks, resize container identity, and chart selection controls.
 */
export function SequentialChart({
  model,
  onToggleKey,
  onPeriodClick,
  onClearSelection,
  containerRef,
}: SequentialChartProps) {
  // A refreshed result can invalidate indices held by the interaction hook.
  // Keep Clear enabled for that stale state even though the model deliberately
  // excludes invalid indices from rendering.
  const hasSelection = model.selection.selectedCount > 0 || model.selection.hasInvalidSelection;
  if (!model.chartData.length) {
    return (
      <div className="flex h-40 items-center justify-center rounded-md border border-dashed border-muted-foreground/30 text-sm text-muted-foreground">
        {model.status === 'malformed'
          ? 'The sequential analysis result is malformed and has no chartable rows.'
          : 'No sequential analysis data available. Adjust your configuration and try again.'}
      </div>
    );
  }

  return (
    <div ref={containerRef}>
      {model.status === 'malformed' ? (
        <div className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-foreground">
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
        margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
        height={CHART_HEIGHT_PX}
        tooltip={{
          shadcn: true,
          className: 'min-w-50',
          indicator: model.tooltip.indicator,
          labelFormatter: model.tooltip.labelFormatter as never,
        }}
        selection={{ selectedIndices: model.selection.selectedIndices, onSelect: onPeriodClick }}
        interactive
      />
      <div className="mt-4 flex flex-wrap items-center justify-center gap-4 px-4">
        {model.groups.map((group) => {
          const isHidden = group.hidden;
          return (
            <button
              key={group.id}
              type="button"
              className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 transition-opacity hover:bg-muted/60"
              style={{ opacity: isHidden ? 0.4 : 1 }}
              onClick={() => {
                onToggleKey(group.id);
              }}
              aria-pressed={!isHidden}
              aria-label={isHidden ? `Show ${group.label}` : `Hide ${group.label}`}
            >
              {model.chartType === 'line' ? (
                <div className="flex items-center">
                  <div className="h-2 w-2 rounded-full" style={{ backgroundColor: group.color }} />
                  <div className="h-0.5 w-3" style={{ backgroundColor: group.color }} />
                  <div className="h-2 w-2 rounded-full" style={{ backgroundColor: group.color }} />
                </div>
              ) : (
                <div className="h-3 w-3 rounded-sm" style={{ backgroundColor: group.color }} />
              )}
              <span
                className="text-sm font-medium text-muted-foreground"
                style={{ textDecoration: isHidden ? 'line-through' : 'none' }}
              >
                {group.label}
              </span>
            </button>
          );
        })}
      </div>
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
