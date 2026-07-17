import { describe, expect, it } from 'vitest';

import { columnMutationReducer, createColumnMutationState } from '../columnMutationState';

describe('columnMutationReducer', () => {
  it('keeps sparse cast-loading state', () => {
    const casting = columnMutationReducer(createColumnMutationState(), {
      type: 'castLoadingChanged',
      column: 'published_at',
      active: true,
    });
    expect(casting.loadingCast).toEqual({ published_at: true });

    const settled = columnMutationReducer(casting, {
      type: 'castLoadingChanged',
      column: 'published_at',
      active: false,
    });
    expect(settled.loadingCast).toEqual({});
  });

  it('keeps canonical schema and datetime modal state together', () => {
    const withSchema = columnMutationReducer(createColumnMutationState(), {
      type: 'schemaApplied',
      columnTypes: { title: 'string', count: 'integer' },
    });
    expect(withSchema.columnTypes).toEqual({ title: 'string', count: 'integer' });

    const requested = columnMutationReducer(withSchema, {
      type: 'datetimeRequested',
      column: 'created_at',
      targetType: 'datetime',
    });
    expect(requested.datetimeModal).toEqual({
      isOpen: true,
      column: 'created_at',
      targetType: 'datetime',
    });

    const closed = columnMutationReducer(requested, { type: 'datetimeClosed' });
    expect(closed.datetimeModal).toEqual({
      isOpen: false,
      column: '',
      targetType: '',
    });
  });
});
