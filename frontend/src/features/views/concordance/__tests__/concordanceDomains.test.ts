import { describe, expect, it } from 'vitest';

import { buildDispersionRows, getDispersionBarWidthPercent } from '../concordanceDispersionDomain';
import {
  buildConcordanceNodeColorMap,
  buildConcordanceSourceColorMap,
  buildMatchedTextColorMap,
  collectConcordanceMatchedTexts,
  findConcordanceSourceNode,
  getConcordanceSourceColor,
  normalizeConcordanceLabelToNodeMap,
} from '../concordanceSourceDomain';
import { buildCombinedSlice, flattenConcordanceGroups } from '../concordanceTableDomain';
import type { ConcordanceNodeResult } from '@/api';

describe('concordanceDomains', () => {
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
describe('matched-text color view models', () => {
  const resultData = {
    'node-1': {
      data: [
        [
          { CONC_matched_text: 'Alpha' },
          { CONC_matched_text: 'beta' },
          { CONC_matched_text: 'Alpha' },
        ],
      ],
    },
    'node-2': {
      data: [[{ CONC_matched_text: 'gamma' }]],
    },
  } as unknown as Record<string, ConcordanceNodeResult>;

  it('collects unique sorted matched texts from raw result rows', () => {
    expect(collectConcordanceMatchedTexts(resultData, { lowercaseMatches: false })).toEqual([
      'Alpha',
      'beta',
      'gamma',
    ]);
  });

  it('normalizes matched text labels when the lowercase option is enabled', () => {
    expect(collectConcordanceMatchedTexts(resultData, { lowercaseMatches: true })).toEqual([
      'alpha',
      'beta',
      'gamma',
    ]);
  });

  it('assigns matched-text colors by palette order', () => {
    expect(buildMatchedTextColorMap(['alpha', 'beta', 'gamma'], ['red', 'blue'])).toEqual({
      alpha: 'red',
      beta: 'blue',
      gamma: 'red',
    });
  });
});

describe('concordance source display helpers', () => {
  const sourceNodes = [
    { id: 'node-1', name: 'Left Corpus' },
    { id: 'node-2', name: 'Right Corpus' },
  ];

  it('normalizes backend label-to-node maps and drops invalid entries', () => {
    expect(
      normalizeConcordanceLabelToNodeMap({
        label_to_node_map: {
          'Left result': 'node-1',
          Missing: null,
          Empty: '',
        },
      }),
    ).toEqual({ 'Left result': 'node-1' });
    expect(normalizeConcordanceLabelToNodeMap({ label_to_node_map: { Empty: '' } })).toBeNull();
    expect(normalizeConcordanceLabelToNodeMap(null)).toBeNull();
  });

  it('builds node and source colour maps from canonical ids and names', () => {
    const nodeColors = buildConcordanceNodeColorMap(
      [
        { id: 'node-1', name: 'Left Corpus' },
        { id: 'node-2', name: 'Right Corpus' },
      ],
      ['red', 'blue'],
    );

    expect(nodeColors).toEqual({
      'node-1': 'red',
      'node-2': 'blue',
    });
    expect(
      buildConcordanceSourceColorMap(
        [
          { id: 'node-1', name: 'Left Corpus' },
          { id: 'node-2', name: 'Right Corpus' },
        ],
        nodeColors,
        ['red', 'blue'],
      ),
    ).toEqual({
      'node-1': 'red',
      'left corpus': 'red',
      'node-2': 'blue',
      'right corpus': 'blue',
    });
  });

  it('applies node colour overrides by selected node id', () => {
    expect(
      buildConcordanceNodeColorMap([{ id: 'node-1', name: 'Left Corpus' }], ['red'], {
        'node-1': '#123456',
      }),
    ).toEqual({
      'node-1': '#123456',
    });
  });

  it('finds the selected source node represented by a rendered source label', () => {
    expect(findConcordanceSourceNode(sourceNodes, 'left corpus')?.id).toBe('node-1');
    expect(findConcordanceSourceNode(sourceNodes, 'right corpus')?.id).toBe('node-2');
    expect(findConcordanceSourceNode(sourceNodes, 'missing')).toBeUndefined();
  });

  it('resolves source colours by exact key, loose key, then deterministic palette fallback', () => {
    expect(getConcordanceSourceColor('Left Corpus', { 'left corpus': '#f00' }, ['#111'])).toBe(
      '#f00',
    );
    expect(getConcordanceSourceColor('Corpus', { 'left corpus': '#0f0' }, ['#111'])).toBe('#0f0');
    expect(getConcordanceSourceColor('A', {}, ['#111', '#222'])).toBe('#222');
    expect(getConcordanceSourceColor('', {}, ['#111'])).toBe('#ffffff');
  });
});

describe('buildCombinedSlice', () => {
  const makeSlice = (
    rows: Record<string, unknown>[][],
    overrides: Partial<ConcordanceNodeResult> = {},
  ): ConcordanceNodeResult => ({
    columns: ['CONC_matched_text', 'speaker'],
    data: rows,
    metadata: {
      concordance_columns: ['CONC_matched_text'],
      metadata_columns: ['speaker'],
      all_columns: ['CONC_matched_text', 'speaker'],
    },
    pagination: {
      page: 1,
      page_size: 20,
      total_source_rows: rows.length,
      total_source_pages: 1,
      result_count: rows.length,
      has_next: false,
      has_prev: false,
    },
    sorting: { sort_by: null, descending: false },
    ...overrides,
  });

  const leftRow = (id: string) => [{ __source_node: 'L', id, CONC_matched_text: id }];
  const rightRow = (id: string) => [{ __source_node: 'R', id, CONC_matched_text: id }];

  it('interleaves grouped rows left-right at equal lengths', () => {
    const left = makeSlice([leftRow('l1'), leftRow('l2')]);
    const right = makeSlice([rightRow('r1'), rightRow('r2')]);

    const combined = buildCombinedSlice(left, right, 1, 20);

    expect(combined.data).toHaveLength(4);
    expect(combined.data.map((group) => group[0]!.id)).toEqual(['l1', 'r1', 'l2', 'r2']);
    expect(combined.pagination.result_count).toBe(4);
  });

  it('appends leftover rows from the longer side in order', () => {
    const left = makeSlice([leftRow('l1'), leftRow('l2'), leftRow('l3')]);
    const right = makeSlice([rightRow('r1')]);

    const combined = buildCombinedSlice(left, right, 1, 20);

    expect(combined.data.map((group) => group[0]!.id)).toEqual(['l1', 'r1', 'l2', 'l3']);
  });

  it('falls back to the populated side when one slice is empty', () => {
    const left = makeSlice([leftRow('l1'), leftRow('l2')]);
    const right = makeSlice([]);

    const combined = buildCombinedSlice(left, right, 1, 20);

    expect(combined.data.map((group) => group[0]!.id)).toEqual(['l1', 'l2']);
  });

  it('unions columns (dedupe, left order first) and recomputes the metadata split', () => {
    const left = makeSlice([leftRow('l1')], {
      columns: ['CONC_matched_text', 'topic'],
    });
    const right = makeSlice([rightRow('r1')], {
      columns: ['CONC_matched_text', 'word_count'],
    });

    const combined = buildCombinedSlice(left, right, 1, 20);

    expect(combined.columns).toEqual(['CONC_matched_text', 'topic', 'word_count']);
    expect(combined.metadata.concordance_columns).toEqual(['CONC_matched_text']);
    expect(combined.metadata.metadata_columns).toEqual(['topic', 'word_count']);
  });

  it('spans the larger node for pagination and derives has_next/has_prev', () => {
    const left = makeSlice([leftRow('l1')], {
      pagination: {
        page: 2,
        page_size: 20,
        total_source_rows: 100,
        total_source_pages: 5,
        result_count: 1,
        has_next: true,
        has_prev: true,
      },
    });
    const right = makeSlice([rightRow('r1')], {
      pagination: {
        page: 2,
        page_size: 20,
        total_source_rows: 40,
        total_source_pages: 2,
        result_count: 1,
        has_next: false,
        has_prev: true,
      },
    });

    const combined = buildCombinedSlice(left, right, 2, 20);

    expect(combined.pagination.total_source_rows).toBe(100);
    expect(combined.pagination.total_source_pages).toBe(5);
    expect(combined.pagination.page).toBe(2);
    expect(combined.pagination.has_next).toBe(true);
    expect(combined.pagination.has_prev).toBe(true);
  });
});
