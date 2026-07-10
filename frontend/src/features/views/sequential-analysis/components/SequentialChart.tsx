import React from 'react';
import { Loader2, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { DisabledReasonTooltip } from '@/components/ui/disabled-reason-tooltip';
import { Input } from '@/components/ui/input';
import { MultiSeriesChart } from '@/features/views/common/components/MultiSeriesChart';
import { acceptPlaceholderOnTab } from '@/features/views/common/placeholderTabFill';
import type { SequentialChartModel } from '../hooks/sequentialChartModel';

interface SequentialChartProps {
  model: SequentialChartModel;
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

/**
 * Renders the chart and interaction controls from a canonical Sequential model.
 *
 * Rendered by: `SequentialAnalysisResultsPanel`. The pure model already owns
 * row/axis/series/legend shaping; this component only binds Recharts selection,
 * legend clicks, resize container identity, and detach controls.
 */
export function SequentialChart({
  model,
  isDetaching,
  onToggleKey,
  onPeriodClick,
  onClearSelection,
  detachNodeName,
  detachNodeNamePlaceholder,
  onDetachNodeNameChange,
  onDetach,
  containerRef,
}: SequentialChartProps) {
  // A refreshed result can invalidate indices held by the interaction hook.
  // Keep Clear enabled for that stale state even though the model deliberately
  // excludes invalid indices from rendering and detachment.
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
            <DisabledReasonTooltip className="min-w-0 flex-1">
              <Input
                id="sequential-new-node-name"
                value={detachNodeName}
                onChange={(event) => {
                  onDetachNodeNameChange(event.target.value);
                }}
                onKeyDown={(event) => {
                  acceptPlaceholderOnTab({
                    event,
                    value: detachNodeName,
                    setValue: onDetachNodeNameChange,
                  });
                }}
                placeholder={detachNodeNamePlaceholder}
                disabled={isDetaching}
                aria-label="New data block name"
                className="min-w-0 flex-1"
              />
            </DisabledReasonTooltip>
          </div>
          <DisabledReasonTooltip
            reason={
              isDetaching || model.selection.canDetach
                ? undefined
                : 'Click periods on the chart (shift-click to extend) to pick a subset to add as a new data block.'
            }
          >
            <Button
              type="button"
              size="sm"
              className="w-full sm:w-auto"
              disabled={!model.selection.canDetach || isDetaching}
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
                  Add to Workspace ({model.selection.selectedCount})
                </>
              )}
            </Button>
          </DisabledReasonTooltip>
        </div>
      </div>
    </div>
  );
}
