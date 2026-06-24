import { describe, expect, it } from 'vitest';

import {
  createPolarsExpressionDraftState,
  polarsExpressionDraftReducer,
} from '../polarsExpressionDraftState';

describe('polarsExpressionDraftState', () => {
  it('initializes each expression context with one editable row', () => {
    const state = createPolarsExpressionDraftState();

    expect(state.activeContext).toBe('filter');
    expect(state.withColumns).toHaveLength(1);
    expect(state.selectExpressions).toHaveLength(1);
    expect(state.sortItems).toHaveLength(1);
    expect(state.groupByState.aggExpressions).toHaveLength(1);
  });

  it('updates generic expression lists by target and row id', () => {
    const state = createPolarsExpressionDraftState();
    const [first] = state.withColumns;

    const updated = polarsExpressionDraftReducer(state, {
      type: 'updateExpressionCode',
      target: 'withColumns',
      id: first!.id,
      code: 'pl.col("text").str.len_chars()',
    });

    expect(updated.withColumns[0]?.code).toBe('pl.col("text").str.len_chars()');
    expect(updated.selectExpressions[0]?.code).toBe('');
  });

  it('routes group-by key and aggregation changes through one reducer', () => {
    const state = createPolarsExpressionDraftState();
    const keyed = polarsExpressionDraftReducer(state, {
      type: 'setGroupByKeyCode',
      code: 'pl.col("speaker")',
    });
    const [agg] = keyed.groupByState.aggExpressions;

    const updated = polarsExpressionDraftReducer(keyed, {
      type: 'updateExpressionCode',
      target: 'groupByAgg',
      id: agg!.id,
      code: 'pl.len()',
    });

    expect(updated.groupByState.keyCode).toBe('pl.col("speaker")');
    expect(updated.groupByState.aggExpressions[0]?.code).toBe('pl.len()');
  });

  it('updates sort code and direction without touching other sort rows', () => {
    const state = polarsExpressionDraftReducer(createPolarsExpressionDraftState(), {
      type: 'addSortExpression',
    });
    const [first, second] = state.sortItems;

    const updatedFirst = polarsExpressionDraftReducer(state, {
      type: 'updateSortCode',
      id: first!.id,
      code: 'pl.col("date")',
    });
    const updatedSecond = polarsExpressionDraftReducer(updatedFirst, {
      type: 'updateSortDescending',
      id: second!.id,
      descending: true,
    });

    expect(updatedSecond.sortItems[0]).toMatchObject({
      id: first!.id,
      code: 'pl.col("date")',
      descending: false,
    });
    expect(updatedSecond.sortItems[1]).toMatchObject({
      id: second!.id,
      code: '',
      descending: true,
    });
  });
});
