import { describe, expect, it } from 'vitest';

import { CONCORDANCE_COLUMN_KEYS } from '../../../common/generatedColumns';
import {
  buildConcordanceRowDetailCustomization,
  buildConcordanceRowDetailPayload,
} from '../../concordanceRowDetail';

describe('concordanceRowDetail', () => {
  const hit = {
    text: 'alpha beta alpha',
    speaker: 'A',
    [CONCORDANCE_COLUMN_KEYS.matchedText]: 'alpha',
    [CONCORDANCE_COLUMN_KEYS.leftToken]: 'before',
    [CONCORDANCE_COLUMN_KEYS.leftTokenFreq]: 3,
    [CONCORDANCE_COLUMN_KEYS.rightToken]: 'after',
    [CONCORDANCE_COLUMN_KEYS.rightTokenFreq]: 4,
    [CONCORDANCE_COLUMN_KEYS.startIdx]: 0,
    [CONCORDANCE_COLUMN_KEYS.endIdx]: 5,
  };

  it('builds grouped hit context and concordance summary fields', () => {
    const item = {
      row: hit,
      nodeId: 'node-1',
      column: 'text',
      groupedHits: [
        hit,
        {
          ...hit,
          [CONCORDANCE_COLUMN_KEYS.startIdx]: 11,
          [CONCORDANCE_COLUMN_KEYS.endIdx]: 16,
        },
      ],
    };
    const payload = buildConcordanceRowDetailPayload(item);
    const customization = buildConcordanceRowDetailCustomization(item, 'alpha', false);

    expect(payload.record).toMatchObject(hit);
    expect(payload.textColumn).toBe('text');
    expect(payload.fullText).toBe('alpha beta alpha');
    expect(payload.excludeMetadataColumns).toContain(CONCORDANCE_COLUMN_KEYS.matchedText);
    expect(payload.excludeMetadataColumns).toContain(CONCORDANCE_COLUMN_KEYS.dispersion);

    const fields = customization.summaryFields ?? [];
    expect(fields.map((field) => [field.label, field.value])).toEqual([
      ['Search Word', 'alpha'],
      ['Matches', '2'],
      ['L1 Word', 'before'],
      ['L1 Freq', '3'],
      ['R1 Word', 'after'],
      ['R1 Freq', '4'],
    ]);
    expect(customization.renderDocumentText?.('alpha beta alpha', hit)).toBeTruthy();
  });

  it('uses one row as the default hit group', () => {
    const item = { row: hit, nodeId: 'node-1', column: 'text' };
    const customization = buildConcordanceRowDetailCustomization(item, 'alpha', false);
    expect(customization.summaryFields?.find((field) => field.label === 'Matches')?.value).toBe(
      '1',
    );
  });
});
