import { describe, expect, it } from 'vitest';

import { getNodeDocumentColumn } from '../documentColumn';

describe('getNodeDocumentColumn', () => {
  it('returns a top-level document column when present', () => {
    expect(getNodeDocumentColumn({ document_column: 'body_text' })).toBe('body_text');
  });

  it('returns a nested graph-node document column when present', () => {
    expect(
      getNodeDocumentColumn({
        data: {
          node: {
            document: 'content',
          },
        },
      }),
    ).toBe('content');
  });

  it('returns undefined when no document column exists', () => {
    expect(getNodeDocumentColumn({ document_column: '   ' })).toBeUndefined();
    expect(getNodeDocumentColumn(null)).toBeUndefined();
  });
});
