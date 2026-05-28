import { describe, expect, it } from 'vitest';
import { collectDocumentColumnText } from '../tokenizerModelSelectorUtils';

describe('collectDocumentColumnText', () => {
  it('packs the selected document column from page rows', () => {
    expect(
      collectDocumentColumnText(
        [
          { text: ' first document ', title: 'ignored' },
          { text: null },
          { text: 'second document' },
          { other: 'missing text' },
        ],
        'text',
      ),
    ).toBe('first document\nsecond document');
  });
});
