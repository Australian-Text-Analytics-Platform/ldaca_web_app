import { describe, expect, it } from 'vitest';

import { deriveSequentialResultVisibility } from '../sequentialResultVisibility';

describe('deriveSequentialResultVisibility', () => {
  it('counts shown and chosen rows after hiding grouped legend entries', () => {
    const visibility = deriveSequentialResultVisibility({
      rows: [
        { group: 'A', time_period: '2024-01', sequential_count: 2 },
        { group: 'B', time_period_formatted: '2024-01', sequential_count: '3' },
        { group: 'A', time_period: '2024-02', sequential_count: 4 },
      ],
      groupByColumns: ['group'],
      hiddenKeys: new Set(['B']),
      chartData: [{ time_period: '2024-01' }, { time_period: '2024-02' }],
      selectedPeriodIndices: new Set([1]),
      resultTotalRecords: 10,
      sourceDocumentCount: 20,
    });

    expect(visibility).toEqual({
      totalPointCount: 10,
      totalDocumentCount: 20,
      shownPointCount: 2,
      shownDocumentCount: 6,
      chosenPointCount: 1,
      chosenDocumentCount: 4,
    });
  });

  it('falls back to raw row and document totals when backend totals are unavailable', () => {
    const visibility = deriveSequentialResultVisibility({
      rows: [
        { time_period: '1', sequential_count: 5 },
        { time_period: '2', sequential_count: '7' },
      ],
      groupByColumns: [],
      hiddenKeys: new Set(),
      chartData: [{ time_period: '1' }, { time_period: '2' }],
      selectedPeriodIndices: new Set(),
      resultTotalRecords: undefined,
      sourceDocumentCount: undefined,
    });

    expect(visibility).toEqual({
      totalPointCount: 2,
      totalDocumentCount: 12,
      shownPointCount: 2,
      shownDocumentCount: 12,
      chosenPointCount: 0,
      chosenDocumentCount: 0,
    });
  });

  it('matches multi-column group keys using the chart legend key format', () => {
    const visibility = deriveSequentialResultVisibility({
      rows: [
        { speaker: 'Ada', stance: 'support', time_period: '1', sequential_count: 1 },
        { speaker: 'Ada', stance: 'critical', time_period: '1', sequential_count: 1 },
      ],
      groupByColumns: ['speaker', 'stance'],
      hiddenKeys: new Set(['Ada - critical']),
      chartData: [{ time_period: '1' }],
      selectedPeriodIndices: new Set([0]),
      resultTotalRecords: undefined,
      sourceDocumentCount: undefined,
    });

    expect(visibility.shownPointCount).toBe(1);
    expect(visibility.chosenPointCount).toBe(1);
  });
});
