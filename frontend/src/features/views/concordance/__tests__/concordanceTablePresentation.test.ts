import { describe, expect, it } from 'vitest';
import { concordanceHeaderMode } from '../concordanceTablePresentation';

const modeFor = (
  columnKey: string,
  overrides: Partial<Parameters<typeof concordanceHeaderMode>[0]> = {},
) =>
  concordanceHeaderMode({
    columnKey,
    documentColumn: 'text',
    metadataColumns: ['speaker'],
    isCombined: false,
    isReview: false,
    ...overrides,
  });

describe('concordanceHeaderMode', () => {
  it('keeps only selected metadata sortable in separated Preview', () => {
    expect(modeFor('speaker')).toBe('sortable');
    expect(modeFor('CONC_matched_text')).toBe('preview-review-hint');
    expect(modeFor('CONC_l1')).toBe('preview-review-hint');
    expect(modeFor('CONC_l1_freq')).toBe('preview-review-hint');
  });

  it('enables materialized scalar analysis fields in separated Review', () => {
    for (const column of [
      'CONC_matched_text',
      'CONC_start_idx',
      'CONC_end_idx',
      'CONC_l1',
      'CONC_r1',
      'CONC_l1_freq',
      'CONC_r1_freq',
    ]) {
      expect(modeFor(column, { isReview: true })).toBe('sortable');
    }
  });

  it('keeps document and full context strings plain in both phases', () => {
    for (const column of ['text', 'CONC_left_context', 'CONC_right_context']) {
      expect(modeFor(column)).toBe('plain');
      expect(modeFor(column, { isReview: true })).toBe('plain');
    }
  });

  it('keeps every combined header plain', () => {
    expect(modeFor('speaker', { isCombined: true, isReview: true })).toBe('plain');
    expect(modeFor('CONC_l1', { isCombined: true, isReview: true })).toBe('plain');
  });
});
