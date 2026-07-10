import { describe, expect, it } from 'vitest';

import { columnMutationReducer, createColumnMutationState } from '../columnMutationState';

describe('columnMutationReducer', () => {
  it('uses the selected delete column as the delete-dialog source of truth', () => {
    const requested = columnMutationReducer(createColumnMutationState(), {
      type: 'deleteRequested',
      column: 'title',
    });

    expect(requested.columnToDelete).toBe('title');

    const stillClosed = columnMutationReducer(createColumnMutationState(), {
      type: 'deleteDialogChanged',
      open: true,
    });
    expect(stillClosed.columnToDelete).toBeNull();

    const dismissed = columnMutationReducer(requested, {
      type: 'deleteDialogChanged',
      open: false,
    });
    expect(dismissed.columnToDelete).toBeNull();
  });

  it('keeps busy maps sparse when cast and column actions complete', () => {
    const casting = columnMutationReducer(createColumnMutationState(), {
      type: 'castLoadingChanged',
      column: 'published_at',
      active: true,
    });
    const mutating = columnMutationReducer(casting, {
      type: 'columnActionLoadingChanged',
      column: 'title',
      active: true,
    });

    expect(mutating.loadingCast).toEqual({ published_at: true });
    expect(mutating.columnActionLoading).toEqual({ title: true });

    const settledCast = columnMutationReducer(mutating, {
      type: 'castLoadingChanged',
      column: 'published_at',
      active: false,
    });
    const settledAll = columnMutationReducer(settledCast, {
      type: 'columnActionLoadingChanged',
      column: 'title',
      active: false,
    });

    expect(settledAll.loadingCast).toEqual({});
    expect(settledAll.columnActionLoading).toEqual({});
  });

  it('removes local dtype metadata and clears matching rename after delete', () => {
    const withSchema = columnMutationReducer(createColumnMutationState(), {
      type: 'schemaApplied',
      columnTypes: { title: 'string', count: 'integer' },
    });
    const renaming = columnMutationReducer(withSchema, {
      type: 'renameStarted',
      column: 'title',
    });
    const withoutColumnType = columnMutationReducer(renaming, {
      type: 'columnTypeRemoved',
      column: 'title',
    });
    const deleted = columnMutationReducer(withoutColumnType, {
      type: 'columnDeleteSucceeded',
      column: 'title',
    });

    expect(deleted.columnTypes).toEqual({ count: 'integer' });
    expect(deleted.renamingColumn).toBeNull();
  });

  it('keeps datetime modal state together', () => {
    const requested = columnMutationReducer(createColumnMutationState(), {
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
