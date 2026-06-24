import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CONCORDANCE_COLUMN_KEYS } from '../../../common/generatedColumns';
import { useConcordanceRowDetail } from '../useConcordanceRowDetail';

describe('useConcordanceRowDetail', () => {
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

  it('opens row details with grouped hit context and concordance summary fields', () => {
    const { result } = renderHook(() =>
      useConcordanceRowDetail({
        currentWorkspaceId: 'workspace-1',
        caseSensitive: false,
        searchWord: 'alpha',
      }),
    );

    act(() => {
      result.current.handleRowClick(hit, 'node-1', 'text', [
        hit,
        {
          ...hit,
          [CONCORDANCE_COLUMN_KEYS.startIdx]: 11,
          [CONCORDANCE_COLUMN_KEYS.endIdx]: 16,
        },
      ]);
    });

    expect(result.current.detailOpen).toBe(true);
    expect(result.current.detailPayload?.record).toMatchObject(hit);
    expect(result.current.detailPayload?.textColumn).toBe('text');
    expect(result.current.detailPayload?.fullText).toBe('alpha beta alpha');
    expect(result.current.detailPayload?.excludeMetadataColumns).toContain(
      CONCORDANCE_COLUMN_KEYS.matchedText,
    );
    expect(result.current.detailPayload?.excludeMetadataColumns).toContain(
      CONCORDANCE_COLUMN_KEYS.dispersion,
    );

    const fields = result.current.concordanceCustomization?.summaryFields ?? [];
    expect(fields.map((field) => [field.label, field.value])).toEqual([
      ['Search Word', 'alpha'],
      ['Matches', '2'],
      ['L1 Word', 'before'],
      ['L1 Freq', '3'],
      ['R1 Word', 'after'],
      ['R1 Freq', '4'],
    ]);
    expect(
      result.current.concordanceCustomization?.renderDocumentText?.('alpha beta alpha', hit),
    ).toBeTruthy();
  });

  it('ignores row clicks when there is no workspace', () => {
    const { result } = renderHook(() =>
      useConcordanceRowDetail({
        currentWorkspaceId: null,
        caseSensitive: false,
        searchWord: 'alpha',
      }),
    );

    act(() => {
      result.current.handleRowClick(hit, 'node-1', 'text');
    });

    expect(result.current.detailOpen).toBe(false);
    expect(result.current.detailPayload).toBeNull();
    expect(result.current.concordanceCustomization).toBeUndefined();
  });
});
