import { describe, expect, it } from 'vitest';

import {
  buildAggregateExpressionRequest,
  normalizeSmartCharacters,
  tokenToPolarsExpression,
  tokensToPolarsExpression,
  type AggregateBuilderToken,
} from '../aggregateExpressionModel';

describe('aggregateExpressionModel', () => {
  it('normalizes smart quotes before expressions reach Polars', () => {
    expect(normalizeSmartCharacters('“hello” and ‘world’')).toBe('"hello" and \'world\'');
  });

  it('serializes column tokens with escaped names and operations', () => {
    const token: AggregateBuilderToken = {
      id: 'token-1',
      kind: 'column',
      column: 'speaker"name',
      dtype: 'string',
      operations: ['str.to_lowercase', 'fill_null'],
    };

    expect(tokenToPolarsExpression(token)).toBe(
      'pl.col("speaker\\"name").str.to_lowercase().fill_null()',
    );
  });

  it('serializes custom tokens as quoted, numeric, or escaped literals', () => {
    expect(tokenToPolarsExpression({ id: 'token-1', kind: 'custom', value: '42' })).toBe(
      'pl.lit(42)',
    );
    expect(tokenToPolarsExpression({ id: 'token-2', kind: 'custom', value: '"kept"' })).toBe(
      'pl.lit("kept")',
    );
    expect(tokenToPolarsExpression({ id: 'token-3', kind: 'custom', value: 'a "quote"' })).toBe(
      'pl.lit("a \\"quote\\"")',
    );
  });

  it('joins token expressions and aliases request payloads when a column name is set', () => {
    const tokens: AggregateBuilderToken[] = [
      { id: 'token-1', kind: 'column', column: 'text', dtype: 'string', operations: [] },
      { id: 'token-2', kind: 'custom', value: '-' },
    ];

    expect(tokensToPolarsExpression(tokens)).toBe('pl.col("text") + pl.lit("-")');
    expect(buildAggregateExpressionRequest('pl.col("text")', 'new"name')).toEqual({
      context: 'with_columns',
      expressions: [{ code: '(pl.col("text")).alias("new\\"name")' }],
    });
  });
});
