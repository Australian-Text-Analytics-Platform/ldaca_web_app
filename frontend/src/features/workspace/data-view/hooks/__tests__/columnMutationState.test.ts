import { Field, Int64, Utf8 } from 'apache-arrow';
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
    const columnFields = {
      title: new Field('title', new Utf8()),
      count: new Field('count', new Int64()),
    };
    const withSchema = columnMutationReducer(createColumnMutationState(), {
      type: 'schemaApplied',
      columnFields,
    });
    expect(withSchema.columnFields).toEqual(columnFields);

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

  it('tracks rename and delete workflows independently from casts', () => {
    const renaming = columnMutationReducer(createColumnMutationState(), {
      type: 'renameStarted',
      column: 'title',
    });
    expect(renaming.renamingColumn).toBe('title');

    const deleting = columnMutationReducer(renaming, {
      type: 'deleteRequested',
      column: 'count',
    });
    expect(deleting.columnToDelete).toBe('count');

    const busy = columnMutationReducer(deleting, {
      type: 'columnActionLoadingChanged',
      column: 'count',
      active: true,
    });
    expect(busy.columnActionLoading).toEqual({ count: true });
    expect(busy.loadingCast).toEqual({});
  });
});
