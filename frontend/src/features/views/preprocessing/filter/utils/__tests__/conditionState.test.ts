import { describe, expect, it } from 'vitest';
import { applyFilterConditionFieldChange, createFilterCondition } from '../conditionState';
import type { ConditionColumnOption, FilterConditionWithId } from '../../../types';

const columns: ConditionColumnOption[] = [
  { name: 'Category', dataType: 'categorical' },
  { name: 'Topics', dataType: 'topic-distribution' },
  { name: 'Created', dataType: 'datetime' },
  { name: 'Score', dataType: 'float' },
];

const baseCondition: FilterConditionWithId = {
  id: 'condition-1',
  column: 'Category',
  operator: 'eq',
  value: '',
  dataType: 'categorical',
  negate: false,
  regex: false,
  caseSensitive: false,
};

describe('conditionState', () => {
  it('creates a condition from the first column default', () => {
    expect(createFilterCondition('next', columns[0])).toMatchObject({
      id: 'next',
      column: 'Category',
      dataType: 'categorical',
      operator: 'in',
      value: [],
    });
  });

  it('resets topic-distribution value and requests checklist options on column change', () => {
    const result = applyFilterConditionFieldChange({
      condition: baseCondition,
      field: 'column',
      value: 'Topics',
      availableColumns: columns,
    });

    expect(result.condition).toMatchObject({
      column: 'Topics',
      dataType: 'topic-distribution',
      value: { topic_id: 0, threshold: 0.05 },
      regex: false,
      caseSensitive: false,
    });
    expect(result.checklistLoadRequest).toEqual({
      column: 'Topics',
      dataType: 'topic-distribution',
    });
    expect(result.shouldResetSearch).toBe(true);
  });

  it('turns categorical scalar values into arrays for in-operator filters', () => {
    const result = applyFilterConditionFieldChange({
      condition: { ...baseCondition, value: 'alpha' },
      field: 'operator',
      value: 'in',
      availableColumns: columns,
    });

    expect(result.condition.value).toEqual([]);
    expect(result.checklistLoadRequest).toEqual({ column: 'Category', dataType: 'categorical' });
  });

  it('turns categorical array values back into scalars for non-list operators', () => {
    const result = applyFilterConditionFieldChange({
      condition: { ...baseCondition, operator: 'in', value: ['alpha', 'beta'] },
      field: 'operator',
      value: 'eq',
      availableColumns: columns,
    });

    expect(result.condition.value).toBe('alpha');
  });

  it('requests datetime and numeric prefill when operators can use stats', () => {
    const datetimeResult = applyFilterConditionFieldChange({
      condition: { ...baseCondition, column: 'Created', dataType: 'datetime' },
      field: 'operator',
      value: 'gte',
      availableColumns: columns,
    });
    const numericResult = applyFilterConditionFieldChange({
      condition: { ...baseCondition, column: 'Score', dataType: 'float' },
      field: 'operator',
      value: 'lte',
      availableColumns: columns,
    });

    expect(datetimeResult.prefillRequest).toEqual({
      kind: 'datetime',
      conditionId: 'condition-1',
      column: 'Created',
      operator: 'gte',
    });
    expect(numericResult.prefillRequest).toEqual({
      kind: 'numeric',
      conditionId: 'condition-1',
      column: 'Score',
      operator: 'lte',
    });
  });
});
