import { describe, expect, it } from 'vitest';
import {
  buildTypedExpressionRequest,
  type ExpressionDraftItem,
  type SortExpressionDraftItem,
} from '../useTypedExpressionSubTab';

const item = (id: string, source: string): ExpressionDraftItem => ({ id, source });
const sortItem = (id: string, source: string, descending: boolean): SortExpressionDraftItem => ({
  id,
  source,
  descending,
});

const columnItem = (name: string) => JSON.stringify({ expression: { op: 'column', name } });

describe('buildTypedExpressionRequest', () => {
  it('parses a filter item into the generated expression contract', () => {
    const filterSource = JSON.stringify({
      expression: {
        op: 'gt',
        left: { op: 'column', name: 'year' },
        right: { op: 'literal', value: 1900 },
      },
    });

    expect(
      buildTypedExpressionRequest({
        activeContext: 'filter',
        filterSource,
        withColumns: [],
        selectExpressions: [],
        sortItems: [],
        groupByState: { keySource: '', aggExpressions: [] },
      }),
    ).toEqual({
      context: 'filter',
      expressions: [
        {
          expression: {
            op: 'gt',
            left: { op: 'column', name: 'year' },
            right: { op: 'literal', value: 1900 },
          },
        },
      ],
    });
  });

  it('drops blank rows and preserves aliases', () => {
    const source = JSON.stringify({
      expression: { op: 'lowercase', operand: { op: 'column', name: 'text' } },
      alias: 'lower_text',
    });
    expect(
      buildTypedExpressionRequest({
        activeContext: 'with_columns',
        filterSource: '',
        withColumns: [item('a', '  '), item('b', source)],
        selectExpressions: [],
        sortItems: [],
        groupByState: { keySource: '', aggExpressions: [] },
      }),
    ).toEqual({
      context: 'with_columns',
      expressions: [
        {
          expression: { op: 'lowercase', operand: { op: 'column', name: 'text' } },
          alias: 'lower_text',
        },
      ],
    });
  });

  it('applies the dedicated sort direction control', () => {
    expect(
      buildTypedExpressionRequest({
        activeContext: 'sort',
        filterSource: '',
        withColumns: [],
        selectExpressions: [],
        sortItems: [sortItem('a', columnItem('year'), true), sortItem('b', '', false)],
        groupByState: { keySource: '', aggExpressions: [] },
      }),
    ).toEqual({
      context: 'sort',
      expressions: [{ expression: { op: 'column', name: 'year' }, descending: true }],
    });
  });

  it('rejects the removed raw-code shape', () => {
    expect(() =>
      buildTypedExpressionRequest({
        activeContext: 'select',
        filterSource: '',
        withColumns: [],
        selectExpressions: [item('a', '{"code":"pl.col(\\"text\\")"}')],
        sortItems: [],
        groupByState: { keySource: '', aggExpressions: [] },
      }),
    ).toThrow('removed raw-code format');
  });
});
