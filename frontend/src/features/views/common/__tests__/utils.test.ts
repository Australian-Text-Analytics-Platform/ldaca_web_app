import { describe, expect, it } from 'vitest';

import { analysisInputsFromRequest, clampDisplayTokenLimit, DEFAULT_TOKEN_LIMIT } from '../utils';

describe('analysis common utils', () => {
  it('uses 25 as the default token limit when no value is provided', () => {
    expect(DEFAULT_TOKEN_LIMIT).toBe(25);
    expect(clampDisplayTokenLimit(undefined).limit).toBe(25);
    expect(clampDisplayTokenLimit(null).limit).toBe(25);
  });

  it('restores ordered multi-Data-Block inputs from an Analysis request', () => {
    expect(
      analysisInputsFromRequest({
        node_ids: ['node-2', 'node-1'],
        node_columns: { 'node-1': 'text', 'node-2': 'body' },
      }),
    ).toEqual([
      { node_id: 'node-2', column: 'body' },
      { node_id: 'node-1', column: 'text' },
    ]);
  });

  it('restores the single Data Block input used by Quotation and Trends requests', () => {
    expect(analysisInputsFromRequest({ node_id: 'quotation-node', column: 'text' }, 1)).toEqual([
      { node_id: 'quotation-node', column: 'text' },
    ]);
    expect(
      analysisInputsFromRequest({ node_id: 'trends-node', time_column: 'created_at' }, 1),
    ).toEqual([{ node_id: 'trends-node', column: 'created_at' }]);
  });

  it('ignores invalid request input identities and caps restored inputs', () => {
    expect(
      analysisInputsFromRequest(
        {
          node_ids: ['', 'node-1', 'node-2'],
          node_columns: { 'node-1': 'text', 'node-2': 'body' },
        },
        1,
      ),
    ).toEqual([{ node_id: 'node-1', column: 'text' }]);
    expect(analysisInputsFromRequest({ node_id: '', column: 'text' }, 1)).toEqual([]);
  });
});
