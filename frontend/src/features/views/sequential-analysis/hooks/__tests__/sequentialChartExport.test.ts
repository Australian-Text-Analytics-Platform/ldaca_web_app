import { describe, expect, it } from 'vitest';

import { buildSequentialChartExportMetadata } from '../sequentialChartExport';

describe('buildSequentialChartExportMetadata', () => {
  it('formats chart header counts and grouped legend entries', () => {
    const metadata = buildSequentialChartExportMetadata({
      nodeName: 'Interviews',
      timeColumn: 'date',
      frequencyDisplay: 'Monthly',
      groupByColumns: ['speaker'],
      chartType: 'area',
      chartConfig: {
        ada: { label: 'Ada', color: '#123456' },
        grace: { label: 'Grace' },
      },
      groupKeys: ['ada', 'grace'],
      hiddenKeys: new Set(['grace']),
      counts: {
        totalPointCount: 12,
        totalDocumentCount: 30,
        shownPointCount: 9,
        shownDocumentCount: 20,
        chosenPointCount: 3,
        chosenDocumentCount: 8,
      },
    });

    expect(metadata.header).toEqual([
      { label: 'Data Block', value: 'Interviews' },
      { label: 'Time Column', value: 'date' },
      { label: 'Frequency', value: 'Monthly' },
      { label: 'Total', value: '12/30' },
      { label: 'Shown', value: '9/20' },
      { label: 'Chosen', value: '3/8' },
      { label: 'Groups', value: 'speaker' },
    ]);
    expect(metadata.legend).toEqual([
      { label: 'Ada', color: '#123456', type: 'area', hidden: false },
      { label: 'Grace', color: '#16a34a', type: 'area', hidden: true },
    ]);
  });

  it('falls back to ungrouped labels when no time column or grouping is selected', () => {
    const metadata = buildSequentialChartExportMetadata({
      nodeName: 'Rows',
      timeColumn: '',
      frequencyDisplay: 'Every row',
      groupByColumns: [],
      chartType: 'bar',
      chartConfig: {},
      groupKeys: ['sequential_count'],
      hiddenKeys: new Set(),
      counts: {
        totalPointCount: 2,
        totalDocumentCount: 2,
        shownPointCount: 2,
        shownDocumentCount: 2,
        chosenPointCount: 0,
        chosenDocumentCount: 0,
      },
    });

    expect(metadata.header[1]).toEqual({ label: 'Time Column', value: '—' });
    expect(metadata.header[6]).toEqual({ label: 'Groups', value: 'None' });
    expect(metadata.legend).toEqual([
      { label: 'sequential_count', color: '#2563eb', type: 'bar', hidden: false },
    ]);
  });
});
