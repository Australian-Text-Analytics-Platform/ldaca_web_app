import { describe, expect, it } from 'vitest';

import {
  buildDispersionRows,
  flattenConcordanceGroups,
  getDispersionBarWidthPercent,
} from '../concordanceViewModels';

describe('concordanceViewModels', () => {
  const grouped = [
    [
      {
        text: 'alpha beta alpha',
        speaker: 'A',
        CONC_left_context: '',
        CONC_matched_text: 'alpha',
        CONC_right_context: 'beta alpha',
        CONC_start_idx: 0,
        CONC_end_idx: 5,
        CONC_l1: '',
        CONC_r1: 'beta',
      },
      {
        text: 'alpha beta alpha',
        speaker: 'A',
        CONC_left_context: 'alpha beta',
        CONC_matched_text: 'alpha',
        CONC_right_context: '',
        CONC_start_idx: 11,
        CONC_end_idx: 16,
        CONC_l1: 'beta',
        CONC_r1: '',
      },
    ],
    [
      {
        text: 'gamma alpha',
        speaker: 'B',
        CONC_left_context: 'gamma',
        CONC_matched_text: 'alpha',
        CONC_right_context: '',
        CONC_start_idx: 6,
        CONC_end_idx: 11,
        CONC_l1: 'gamma',
        CONC_r1: '',
      },
    ],
  ];

  it('flattens grouped concordance rows for the normal KWIC table', () => {
    const flattened = flattenConcordanceGroups(grouped);

    expect(flattened).toHaveLength(3);
    expect(flattened.map((row) => row.speaker)).toEqual(['A', 'A', 'B']);
  });

  it('builds one dispersion row per grouped document', () => {
    const rows = buildDispersionRows(grouped);

    expect(rows).toHaveLength(2);
    expect(rows[0]!.speaker).toBe('A');
    expect(rows[0]!.CONC_dispersion).toEqual(grouped[0]);
    expect(rows[1]!.CONC_dispersion).toEqual(grouped[1]);
    expect(rows[0]!).not.toHaveProperty('CONC_left_context');
    expect(rows[0]!).not.toHaveProperty('CONC_matched_text');
  });

  it('computes a proportional bar width from the longest text in the table', () => {
    const rows = buildDispersionRows(grouped);
    const longestTextLength = 'alpha beta alpha'.length;

    expect(getDispersionBarWidthPercent(rows[0]!, 'text', longestTextLength)).toBe(100);
    expect(getDispersionBarWidthPercent(rows[1]!, 'text', longestTextLength)).toBeCloseTo(68.75);
  });
});
