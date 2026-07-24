import { describe, expect, it } from 'vitest';

import {
  createTypedExpressionDraftState,
  typedExpressionDraftReducer,
} from '../typedExpressionDraftState';

describe('typedExpressionDraftState', () => {
  it('initializes each expression context with one editable row', () => {
    const state = createTypedExpressionDraftState();

    expect(state.activeContext).toBe('filter');
    expect(state.withColumns).toHaveLength(1);
    expect(state.selectExpressions).toHaveLength(1);
    expect(state.sortItems).toHaveLength(1);
    expect(state.groupByState.aggExpressions).toHaveLength(1);
  });

  it('updates generic expression lists by target and row id', () => {
    const state = createTypedExpressionDraftState();
    const [first] = state.withColumns;

    const updated = typedExpressionDraftReducer(state, {
      type: 'updateExpressionSource',
      target: 'withColumns',
      id: first!.id,
      source: '{"expression":{"op":"column","name":"text"}}',
    });

    expect(updated.withColumns[0]?.source).toContain('"column"');
    expect(updated.selectExpressions[0]?.source).toBe('');
  });

  it('routes group-by key and aggregation changes through one reducer', () => {
    const state = createTypedExpressionDraftState();
    const keyed = typedExpressionDraftReducer(state, {
      type: 'setGroupByKeySource',
      source: '{"expression":{"op":"column","name":"speaker"}}',
    });
    const [agg] = keyed.groupByState.aggExpressions;

    const updated = typedExpressionDraftReducer(keyed, {
      type: 'updateExpressionSource',
      target: 'groupByAgg',
      id: agg!.id,
      source: '{"expression":{"op":"count","operand":{"op":"column","name":"speaker"}}}',
    });

    expect(updated.groupByState.keySource).toContain('"speaker"');
    expect(updated.groupByState.aggExpressions[0]?.source).toContain('"count"');
  });

  it('updates sort source and direction independently', () => {
    const state = typedExpressionDraftReducer(createTypedExpressionDraftState(), {
      type: 'addSortExpression',
    });
    const [first, second] = state.sortItems;

    const updatedFirst = typedExpressionDraftReducer(state, {
      type: 'updateSortSource',
      id: first!.id,
      source: '{"expression":{"op":"column","name":"date"}}',
    });
    const updatedSecond = typedExpressionDraftReducer(updatedFirst, {
      type: 'updateSortDescending',
      id: second!.id,
      descending: true,
    });

    expect(updatedSecond.sortItems[0]).toMatchObject({
      id: first!.id,
      source: '{"expression":{"op":"column","name":"date"}}',
      descending: false,
    });
    expect(updatedSecond.sortItems[1]).toMatchObject({
      id: second!.id,
      source: '',
      descending: true,
    });
  });
});
