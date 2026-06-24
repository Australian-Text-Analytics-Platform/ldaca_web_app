import type { ChartConfig } from '@/components/ui/chart';
import type { ChartExportHeaderItem, ChartExportLegendItem } from '@/lib/chartExport';

import {
  getSequentialPaletteColor,
  type ChartTypeOption,
} from './sequentialChartModel';

interface SequentialChartExportCounts {
  totalPointCount: number;
  totalDocumentCount: number;
  shownPointCount: number;
  shownDocumentCount: number;
  chosenPointCount: number;
  chosenDocumentCount: number;
}

interface SequentialChartExportInput {
  nodeName: string;
  timeColumn: string;
  frequencyDisplay: string;
  groupByColumns: string[];
  chartType: ChartTypeOption;
  chartConfig: ChartConfig;
  groupKeys: string[];
  hiddenKeys: Set<string>;
  counts: SequentialChartExportCounts;
}

export interface SequentialChartExportMetadata {
  header: ChartExportHeaderItem[];
  legend: ChartExportLegendItem[];
}

/**
 * Builds the header and legend metadata embedded in downloaded sequential charts.
 * Used by: SequentialAnalysisFeature's download handler because export context
 * should stay in sync with the rendered result summary without keeping the
 * formatting rules inside the feature component.
 * Flow: format the same total/shown/chosen counters shown in the panel, then
 * map rendered chart series into export legend rows with fallback palette
 * colours for any series missing chart config.
 */
export function buildSequentialChartExportMetadata({
  nodeName,
  timeColumn,
  frequencyDisplay,
  groupByColumns,
  chartType,
  chartConfig,
  groupKeys,
  hiddenKeys,
  counts,
}: SequentialChartExportInput): SequentialChartExportMetadata {
  const header: ChartExportHeaderItem[] = [
    { label: 'Data Block', value: nodeName },
    { label: 'Time Column', value: timeColumn || '—' },
    { label: 'Frequency', value: frequencyDisplay },
    {
      label: 'Total',
      value: `${String(counts.totalPointCount)}/${String(counts.totalDocumentCount)}`,
    },
    {
      label: 'Shown',
      value: `${String(counts.shownPointCount)}/${String(counts.shownDocumentCount)}`,
    },
    {
      label: 'Chosen',
      value: `${String(counts.chosenPointCount)}/${String(counts.chosenDocumentCount)}`,
    },
    { label: 'Groups', value: groupByColumns.length ? groupByColumns.join(', ') : 'None' },
  ];

  const legendType = chartType === 'line' ? 'line' : chartType === 'bar' ? 'bar' : 'area';
  const legend: ChartExportLegendItem[] = groupKeys.map((key, index) => ({
    label: chartConfig[key]?.label ?? key,
    color: chartConfig[key]?.color ?? getSequentialPaletteColor(index) ?? '#888888',
    type: legendType,
    hidden: hiddenKeys.has(key),
  }));

  return { header, legend };
}
