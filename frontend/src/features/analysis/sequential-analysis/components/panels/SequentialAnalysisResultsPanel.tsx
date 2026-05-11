import React from 'react';
import { Download } from 'lucide-react';

import HelpIcon from '@/components/help/HelpIcon';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { SequentialChart } from '../SequentialChart';
import type { ChartTypeOption } from '../../hooks/useSequentialAnalysisTaskFlow';

interface ResultsSummary {
  timeColumn: string;
  groupBy: string[];
  columnType: 'datetime' | 'numeric';
  numericOrigin: number | null;
  numericInterval: number | null;
  frequencyDisplay: string;
}

interface PointCounts {
  total: number;
  totalDocuments: number;
  shown: number;
  shownDocuments: number;
  chosen: number;
  chosenDocuments: number;
}

export interface SequentialAnalysisResultsPanelProps {
  resultsSummary: string;
  summary: ResultsSummary;
  counts: PointCounts;
  minGroupSizeInput: string;
  onMinGroupSizeChange: (value: string) => void;
  chartType: ChartTypeOption;
  onChartTypeChange: (value: ChartTypeOption) => void;
  onDownloadClick: () => void;

  chartData: Array<Record<string, unknown>>;
  chartConfig: Record<string, { label?: string; color?: string }>;
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
  containerRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * Trends and Sequence results card: summary stat grid + chart + detach
 * controls. Extracted from SequentialAnalysisFeature.tsx — receives the
 * derived summary values from `useSequentialResultSummary` plus the chart
 * machinery from `useSequentialAnalysisTaskFlow` as props.
 */
export const SequentialAnalysisResultsPanel: React.FC<SequentialAnalysisResultsPanelProps> = ({
  resultsSummary,
  summary,
  counts,
  minGroupSizeInput,
  onMinGroupSizeChange,
  chartType,
  onChartTypeChange,
  onDownloadClick,
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
}) => (
  <Card className="mt-6">
    <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div>
        <CardTitle className="flex items-center gap-2">
          Trends and Sequence Results
          <HelpIcon
            targetKey="analysis.sequential-analysis.results"
            label="Sequential analysis results"
            tooltip={`${resultsSummary}. Review the chart, summaries, and adjust chart type.`}
          />
        </CardTitle>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Min Group Size</span>
        <Input
          type="number"
          min="0"
          step="1"
          value={minGroupSizeInput}
          onChange={(event) => onMinGroupSizeChange(event.target.value)}
          className="w-24 text-sm"
          aria-label="Min Group Size"
        />
        <span className="text-sm text-muted-foreground">Chart Type</span>
        <Select
          value={chartType}
          onValueChange={(value) => onChartTypeChange(value as ChartTypeOption)}
        >
          <SelectTrigger className="w-35 text-sm">
            <SelectValue placeholder="Select chart" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="line">Line Chart</SelectItem>
            <SelectItem value="bar">Bar Chart</SelectItem>
            <SelectItem value="area">Area Chart</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="icon"
          aria-label="Download chart"
          onClick={onDownloadClick}
        >
          <Download className="h-4 w-4" />
        </Button>
      </div>
    </CardHeader>
    <CardContent className="space-y-4">
      <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2 xl:grid-cols-6">
        <div className="rounded-md border border-border/60 p-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Time Column
          </span>
          <div className="mt-1 text-base font-semibold text-foreground">
            {summary.timeColumn || '—'}
          </div>
        </div>
        <div className="rounded-md border border-border/60 p-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {summary.columnType === 'numeric' ? 'Numeric Interval' : 'Frequency'}
          </span>
          <div className="mt-1 text-base font-semibold capitalize text-foreground">
            {summary.columnType === 'numeric'
              ? summary.numericInterval != null
                ? `${summary.numericInterval}${summary.numericOrigin != null ? ` (origin ${summary.numericOrigin})` : ''}`
                : '—'
              : summary.frequencyDisplay}
          </div>
        </div>
        <div className="rounded-md border border-border/60 p-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Total
          </span>
          <div className="mt-1 text-base font-semibold text-foreground">
            {`${counts.total}/${counts.totalDocuments}`}
          </div>
        </div>
        <div className="rounded-md border border-border/60 p-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Shown
          </span>
          <div className="mt-1 text-base font-semibold text-foreground">
            {`${counts.shown}/${counts.shownDocuments}`}
          </div>
        </div>
        <div className="rounded-md border border-border/60 p-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Chosen
          </span>
          <div className="mt-1 text-base font-semibold text-foreground">
            {`${counts.chosen}/${counts.chosenDocuments}`}
          </div>
        </div>
        <div className="rounded-md border border-border/60 p-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Groups
          </span>
          <div className="mt-1 text-base font-semibold text-foreground">
            {summary.groupBy.length ? summary.groupBy.join(', ') : 'None'}
          </div>
        </div>
      </div>

      <SequentialChart
        chartType={chartType}
        chartData={chartData}
        chartConfig={chartConfig}
        groupKeys={groupKeys}
        groupPointCounts={groupPointCounts}
        hiddenKeys={hiddenKeys}
        selectedPeriodIndices={selectedPeriodIndices}
        canDetach={canDetach}
        isDetaching={isDetaching}
        onToggleKey={onToggleKey}
        onPeriodClick={onPeriodClick}
        onClearSelection={onClearSelection}
        detachNodeName={detachNodeName}
        detachNodeNamePlaceholder={detachNodeNamePlaceholder}
        onDetachNodeNameChange={onDetachNodeNameChange}
        onDetach={onDetach}
        containerRef={containerRef}
      />
    </CardContent>
  </Card>
);
