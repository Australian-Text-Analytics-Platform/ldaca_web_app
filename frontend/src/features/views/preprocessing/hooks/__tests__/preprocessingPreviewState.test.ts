import { describe, expect, it } from 'vitest';
import type { PreviewPagination } from '../../types';
import {
  createPreprocessingPreviewState,
  preprocessingPreviewReducer,
  resolvePreviewPaging,
  type PreviewRequestContext,
} from '../preprocessingPreviewState';

const pagination = (page: number, pageSize = 10): PreviewPagination => ({
  has_next: page < 3,
  has_prev: page > 1,
  page,
  page_size: pageSize,
  total_pages: 3,
  total_rows: 25,
});

const context: PreviewRequestContext = {
  signature: 'node-1::filter',
  initialPage: 1,
  initialPageSize: 10,
  page: 1,
  pageSize: 10,
};

describe('preprocessingPreviewReducer', () => {
  it('keeps previous data visible while a new preview loads', () => {
    const loadedState = preprocessingPreviewReducer(
      createPreprocessingPreviewState(context),
      {
        type: 'success',
        context,
        response: {
          data: [{ token: 'old' }],
          columns: ['token'],
          pagination: pagination(1),
        },
      },
    );

    const loadingState = preprocessingPreviewReducer(loadedState, { type: 'loading', context });

    expect(loadingState.loading).toBe(true);
    expect(loadingState.error).toBeNull();
    expect(loadingState.data).toEqual([{ token: 'old' }]);
  });

  it('normalizes successful responses and adopts the backend page when it differs', () => {
    const state = preprocessingPreviewReducer(
      createPreprocessingPreviewState(context),
      {
        type: 'success',
        context,
        response: {
          data: [{ token: 'next' }],
          columns: ['token'],
          pagination: pagination(2),
        },
      },
    );

    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
    expect(state.data).toEqual([{ token: 'next' }]);
    expect(state.columns).toEqual(['token']);
    expect(resolvePreviewPaging(state, context)).toEqual({ page: 2, pageSize: 10 });
  });

  it('clears rows and records the error when a preview fetch fails', () => {
    const loadedState = preprocessingPreviewReducer(
      createPreprocessingPreviewState(context),
      {
        type: 'success',
        context,
        response: {
          data: [{ token: 'old' }],
          columns: ['token'],
          pagination: pagination(1),
        },
      },
    );

    const errorState = preprocessingPreviewReducer(loadedState, {
      type: 'error',
      message: 'Preview failed',
    });

    expect(errorState.loading).toBe(false);
    expect(errorState.error).toBe('Preview failed');
    expect(errorState.data).toEqual([]);
    expect(errorState.pagination).toBeNull();
  });

  it('binds pagination to the active signature and resets page size changes to page one', () => {
    const initialState = createPreprocessingPreviewState(context);
    const pageTwoState = preprocessingPreviewReducer(initialState, {
      type: 'set-page',
      context,
      page: 2,
      pageSize: 10,
    });

    expect(resolvePreviewPaging(pageTwoState, context)).toEqual({ page: 2, pageSize: 10 });
    expect(
      resolvePreviewPaging(pageTwoState, {
        signature: 'node-2::filter',
        initialPage: 1,
        initialPageSize: 10,
      }),
    ).toEqual({ page: 1, pageSize: 10 });

    const resizedState = preprocessingPreviewReducer(pageTwoState, {
      type: 'set-page-size',
      context,
      pageSize: 50,
    });

    expect(resolvePreviewPaging(resizedState, context)).toEqual({ page: 1, pageSize: 50 });
  });

  it('clears stale data when the preview becomes disabled', () => {
    const loadedState = preprocessingPreviewReducer(
      createPreprocessingPreviewState(context),
      {
        type: 'success',
        context,
        response: {
          data: [{ token: 'old' }],
          columns: ['token'],
          pagination: pagination(1),
        },
      },
    );

    const disabledState = preprocessingPreviewReducer(loadedState, {
      type: 'disabled',
      context: { ...context, signature: 'disabled' },
    });

    expect(disabledState.data).toEqual([]);
    expect(disabledState.columns).toEqual([]);
    expect(disabledState.pagination).toBeNull();
    expect(disabledState.loading).toBe(false);
    expect(disabledState.error).toBeNull();
  });
});
