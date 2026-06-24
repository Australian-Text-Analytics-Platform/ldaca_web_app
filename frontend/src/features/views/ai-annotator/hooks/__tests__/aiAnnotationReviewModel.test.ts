import { describe, expect, it } from 'vitest';

import {
  applyAiAnnotationReviewEditToRows,
  buildAiAnnotationEditKey,
  deriveAiAnnotationReviewCategories,
  deriveAiAnnotationReviewProviders,
  getAiAnnotationReviewValue,
  getPersistedAiAnnotationValue,
  stringifyAiAnnotationCell,
} from '../aiAnnotationReviewModel';

describe('aiAnnotationReviewModel', () => {
  const rows: Record<string, unknown>[] = [
    {
      text: 'first row',
      annotation: [
        { provider: 'assistant', annotation: 'support' },
        { provider: 'human', annotation: 'critical' },
      ],
    },
    {
      text: 'second row',
      annotation: [{ provider: 'assistant', annotation: 'neutral' }],
    },
  ];

  it('stringifies arbitrary review cell values for stable table display', () => {
    expect(stringifyAiAnnotationCell(null)).toBe('');
    expect(stringifyAiAnnotationCell({ value: 1 })).toBe('{"value":1}');
    expect(stringifyAiAnnotationCell(42)).toBe('42');
  });

  it('reads persisted annotations and applies draft overrides by edit key', () => {
    const editKey = buildAiAnnotationEditKey(3, 'assistant');

    expect(getPersistedAiAnnotationValue(rows[0] ?? {}, 'assistant', 'annotation')).toBe('support');
    expect(
      getAiAnnotationReviewValue({
        row: rows[0] ?? {},
        providerName: 'assistant',
        rowIndex: 3,
        annotationColumn: 'annotation',
        reviewEdits: { [editKey]: 'draft value' },
      }),
    ).toBe('draft value');
  });

  it('updates only the global review row and appends missing providers', () => {
    const updatedRows = applyAiAnnotationReviewEditToRows({
      rows,
      page: 1,
      pageSize: 2,
      rowIndex: 1,
      annotationColumn: 'annotation',
      providerName: 'human',
      annotation: 'support',
    });

    expect(updatedRows[0]).toBe(rows[0]);
    expect(updatedRows[1]?.annotation).toEqual([
      { provider: 'assistant', annotation: 'neutral' },
      { provider: 'human', annotation: 'support' },
    ]);
  });

  it('derives providers and categories from stored, discovered, and local options', () => {
    expect(
      deriveAiAnnotationReviewProviders(rows, 'annotation', ['assistant'], ['new user']),
    ).toEqual(['assistant', 'human', 'new user']);
    expect(deriveAiAnnotationReviewCategories(rows, 'annotation', ['support'], ['mixed'])).toEqual([
      'support',
      'critical',
      'neutral',
      'mixed',
    ]);
  });
});
