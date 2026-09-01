import {
  Dictionary,
  Field,
  FixedSizeList,
  Float64,
  Int32,
  Int64,
  Struct,
  TimestampMillisecond,
  Utf8,
} from 'apache-arrow';
import { describe, expect, it } from 'vitest';
import { arrowTypeName } from '@/lib/arrow/arrowTable';
import { TOPIC_COVERAGE_EXTENSION } from '@/lib/arrow/semanticTypes';
import { applyFilterConditionFieldChange, createFilterCondition } from '../conditionState';
import type { ConditionColumnOption, FilterConditionWithId } from '../../../types';

const categoryField = new Field('Category', new Dictionary(new Utf8(), new Int32()));
const topicEntry = new Field(
  'item',
  new Struct([new Field('topic_id', new Int64()), new Field('coverage', new Float64())]),
);
const topicField = new Field(
  'Topics',
  new FixedSizeList(2, topicEntry),
  true,
  new Map([['ARROW:extension:name', TOPIC_COVERAGE_EXTENSION]]),
);
const createdField = new Field('Created', new TimestampMillisecond());
const scoreField = new Field('Score', new Float64());
const column = (name: string, field: Field): ConditionColumnOption => ({
  name,
  typeName: arrowTypeName(field),
  field,
});
const columns: ConditionColumnOption[] = [
  column('Category', categoryField),
  column('Topics', topicField),
  column('Created', createdField),
  column('Score', scoreField),
];

const baseCondition: FilterConditionWithId = {
  id: 'condition-1',
  column: 'Category',
  operator: 'eq',
  value: '',
  field: categoryField,
  negate: false,
  regex: false,
  caseSensitive: false,
};

describe('conditionState', () => {
  it('creates a condition from the first column default', () => {
    expect(createFilterCondition('next', columns[0])).toMatchObject({
      id: 'next',
      column: 'Category',
      operator: 'in',
      value: [],
      field: categoryField,
    });
  });

  it('resets Topic Coverage value and requests checklist options on column change', () => {
    const result = applyFilterConditionFieldChange({
      condition: baseCondition,
      field: 'column',
      value: 'Topics',
      availableColumns: columns,
    });

    expect(result.condition).toMatchObject({
      column: 'Topics',
      field: topicField,
      value: { topic_id: 0, threshold: 0.05 },
      regex: false,
      caseSensitive: false,
    });
    expect(result.checklistLoadRequest).toEqual({
      column: 'Topics',
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
    expect(result.checklistLoadRequest).toEqual({ column: 'Category' });
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
      condition: { ...baseCondition, column: 'Created', field: createdField },
      field: 'operator',
      value: 'gte',
      availableColumns: columns,
    });
    const numericResult = applyFilterConditionFieldChange({
      condition: { ...baseCondition, column: 'Score', field: scoreField },
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
