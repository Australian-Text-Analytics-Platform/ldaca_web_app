import { describe, expect, it } from 'vitest';
import {
  buildPolarsExpressionRequest,
  type ExpressionItem,
  type SortExpressionItem,
} from '../usePolarsExpressionSubTab';

const item = (id: string, code: string): ExpressionItem => ({ id, code });
const sortItem = (id: string, code: string, descending: boolean): SortExpressionItem => ({
  id,
  code,
  descending,
});

describe('buildPolarsExpressionRequest', () => {
  it('serializes filter code without dropping an empty filter expression', () => {
    expect(
      buildPolarsExpressionRequest({
        activeContext: 'filter',
        filterCode: ' pl.col("year") > 1900 ',
        withColumns: [],
        selectExpressions: [],
        sortItems: [],
        groupByState: { keyCode: '', aggExpressions: [] },
      }),
    ).toEqual({
      context: 'filter',
      expressions: [{ code: 'pl.col("year") > 1900' }],
    });
  });

  it('drops blank with-columns drafts and trims the remaining expressions', () => {
    expect(
      buildPolarsExpressionRequest({
        activeContext: 'with_columns',
        filterCode: '',
        withColumns: [item('a', '  '), item('b', 'pl.col("text").str.len_chars()')],
        selectExpressions: [],
        sortItems: [],
        groupByState: { keyCode: '', aggExpressions: [] },
      }),
    ).toEqual({
      context: 'with_columns',
      expressions: [{ code: 'pl.col("text").str.len_chars()' }],
    });
  });

  it('preserves sort direction for non-empty sort expressions', () => {
    expect(
      buildPolarsExpressionRequest({
        activeContext: 'sort',
        filterCode: '',
        withColumns: [],
        selectExpressions: [],
        sortItems: [sortItem('a', ' pl.col("year") ', true), sortItem('b', '', false)],
        groupByState: { keyCode: '', aggExpressions: [] },
      }),
    ).toEqual({
      context: 'sort',
      expressions: [{ code: 'pl.col("year")', descending: true }],
    });
  });

  it('serializes group-by keys and aggregate expressions', () => {
    expect(
      buildPolarsExpressionRequest({
        activeContext: 'group_by_agg',
        filterCode: '',
        withColumns: [],
        selectExpressions: [],
        sortItems: [],
        groupByState: {
          keyCode: ' pl.col("speaker") ',
          aggExpressions: [item('a', 'pl.len()'), item('b', '  ')],
        },
      }),
    ).toEqual({
      context: 'group_by_agg',
      group_by: [{ expression: { op: 'literal', value: 'pl.col("speaker")' } }],
      expressions: [{ code: 'pl.len()' }],
    });
  });

  it('serializes select expressions as the default expression context', () => {
    expect(
      buildPolarsExpressionRequest({
        activeContext: 'select',
        filterCode: '',
        withColumns: [],
        selectExpressions: [item('a', ' pl.col("text") ')],
        sortItems: [],
        groupByState: { keyCode: '', aggExpressions: [] },
      }),
    ).toEqual({
      context: 'select',
      expressions: [{ code: 'pl.col("text")' }],
    });
  });
});
