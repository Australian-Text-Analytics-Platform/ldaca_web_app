import React from 'react';
import { Download, Info } from 'lucide-react';

import HelpIcon from '@/components/help/HelpIcon';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { SequentialChart } from '../SequentialChart';
import type {
  ChartTypeOption,
  SequentialChartModel,
  SequentialXAxisType,
} from '../../hooks/sequentialChartModel';

export interface SequentialAnalysisResultsPanelProps {
  resultsSummary: string;
  model: SequentialChartModel;
  onChartTypeChange: (value: ChartTypeOption) => void;
  onXAxisTypeChange: (value: SequentialXAxisType) => void;
  onDownloadClick: () => void;
  onAddToWorkspace: () => void;
  addToWorkspaceDisabled: boolean;
  dataResetKey: string;

  onToggleGroupIndices: (groupIndices: readonly number[]) => void;
  onUncasedChange: (value: boolean) => void;
  onPeriodClick: (index: number, shiftHeld: boolean) => void;
  onPeriodRangeSelect: (startIndex: number, endIndex: number, shiftHeld: boolean) => void;
  onClearSelection: () => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * Rendered by: `SequentialAnalysisFeature` as the Trends result card. It reads
 * summary, counts, chart, legend, and selection metadata from one canonical
 * `SequentialChartModel`, while keeping chart-type/axis interactions outside
 * the pure model.
 */
export function SequentialAnalysisResultsPanel({
  resultsSummary,
  model,
  onChartTypeChange,
  onXAxisTypeChange,
  onDownloadClick,
  onAddToWorkspace,
  addToWorkspaceDisabled,
  dataResetKey,
  onToggleGroupIndices,
  onUncasedChange,
  onPeriodClick,
  onPeriodRangeSelect,
  onClearSelection,
  containerRef,
}: SequentialAnalysisResultsPanelProps) {
  return (
    <Card className="mt-6">
      <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <CardTitle data-guidance="trends-results" className="flex items-center gap-2">
            Trends and Sequence Results
            <HelpIcon
              targetKey="analysis.sequential-analysis.results"
              label="Sequential analysis results"
              tooltip={`${resultsSummary}. Review the chart, summaries, and adjust chart type.`}
            />
          </CardTitle>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" disabled={addToWorkspaceDisabled} onClick={onAddToWorkspace}>
            Add to Workspace
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <SequentialChart
          model={model}
          onToggleGroupIndices={onToggleGroupIndices}
          onUncasedChange={onUncasedChange}
          onPeriodClick={onPeriodClick}
          onPeriodRangeSelect={onPeriodRangeSelect}
          onClearSelection={onClearSelection}
          dataResetKey={dataResetKey}
          containerRef={containerRef}
          toolbarStart={
            <>
              <span className="shrink-0 text-body text-description">Chart Type</span>
              <Select
                value={model.chartType}
                onValueChange={(value) => {
                  onChartTypeChange(value as ChartTypeOption);
                }}
              >
                <SelectTrigger className="w-35 shrink-0 text-body">
                  <SelectValue placeholder="Select chart" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="line">Line Chart</SelectItem>
                  <SelectItem value="bar">Bar Chart</SelectItem>
                  <SelectItem value="area">Area Chart</SelectItem>
                </SelectContent>
              </Select>
              <span className="flex shrink-0 items-center gap-1 text-body text-description">
                X-axis
                <Info className="h-3.5 w-3.5 cursor-help text-description/70" aria-hidden="true" />
              </span>
              <Select
                value={model.xAxisType}
                onValueChange={(value) => {
                  onXAxisTypeChange(value as SequentialXAxisType);
                }}
              >
                <SelectTrigger
                  className="w-35 shrink-0 text-body"
                  title={
                    model.xAxisType === 'number'
                      ? 'Linear axis: time positions are spaced proportionally. Periods with no data appear as visible gaps — accurate but can look sparse for irregular series.'
                      : 'Categorical axis: every recorded period is given equal width. Missing periods are hidden, which makes dense series easier to read but can mask gaps in time.'
                  }
                >
                  <SelectValue placeholder="X-axis type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="category">Categorical</SelectItem>
                  <SelectItem value="number">Linear</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="icon"
                className="size-control-sm shrink-0"
                aria-label="Download chart"
                onClick={onDownloadClick}
              >
                <Download className="h-4 w-4" />
              </Button>
            </>
          }
        />
      </CardContent>
    </Card>
  );
}
