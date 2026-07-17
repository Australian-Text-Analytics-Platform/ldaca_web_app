import { describe, expect, it } from 'vitest';

import { buildReplaceRequest, resolveReplaceOutputColumnName } from '../replaceRequestModel';

describe('replaceRequestModel', () => {
  const baseDraft = {
    selectedColumn: 'Body',
    pattern: String.raw`\d+`,
    replacement: '#',
    outputColumnName: '',
    mode: 'replace' as const,
    n: null,
    connector: '',
  };

  it('builds replace-all requests with source-column output default', () => {
    expect(buildReplaceRequest(baseDraft)).toEqual({
      source_column: 'Body',
      pattern: String.raw`\d+`,
      replacement: '#',
      output_column: 'Body',
      mode: 'replace',
      count: 'all',
      match_limit: undefined,
      connector: undefined,
    });
  });

  it('builds first-match extract requests with connector and custom output', () => {
    expect(
      buildReplaceRequest({
        ...baseDraft,
        mode: 'extract',
        outputColumnName: 'matches',
        n: 2,
        connector: '; ',
      }),
    ).toEqual({
      source_column: 'Body',
      pattern: String.raw`\d+`,
      replacement: '#',
      output_column: 'matches',
      mode: 'extract',
      count: 'first',
      match_limit: 2,
      connector: '; ',
    });
  });

  it('rejects incomplete drafts before preview or apply calls', () => {
    expect(buildReplaceRequest({ ...baseDraft, selectedColumn: '' })).toBeNull();
    expect(buildReplaceRequest({ ...baseDraft, pattern: '' })).toBeNull();
  });

  it('trims only the custom output name when resolving display defaults', () => {
    expect(
      resolveReplaceOutputColumnName({
        selectedColumn: 'Body',
        outputColumnName: '  Cleaned Body  ',
      }),
    ).toBe('Cleaned Body');
  });
});
