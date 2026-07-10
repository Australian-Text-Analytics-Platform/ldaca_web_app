import type { ChartExportHeaderItem, ChartExportLegendItem } from '@/lib/chartExport';
import type { SequentialChartModel } from './sequentialChartModel';

interface SequentialChartExportInput {
  nodeName: string;
  model: SequentialChartModel;
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
 * Flow: format the model's canonical result summary/counts and reuse its
 * export-ready legend, so downloaded metadata cannot rebuild series identity
 * differently from the rendered chart.
 */
export function buildSequentialChartExportMetadata({
  nodeName,
  model,
}: SequentialChartExportInput): SequentialChartExportMetadata {
  const { summary, counts } = model;
  const header: ChartExportHeaderItem[] = [
    { label: 'Data Block', value: nodeName },
    { label: 'Time Column', value: summary.timeColumn || '—' },
    { label: 'Frequency', value: summary.frequencyDisplay },
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
    { label: 'Groups', value: summary.groupBy.length ? summary.groupBy.join(', ') : 'None' },
  ];
  return { header, legend: model.legend };
}
