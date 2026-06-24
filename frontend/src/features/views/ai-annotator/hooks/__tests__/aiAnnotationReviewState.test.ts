import { describe, expect, it } from 'vitest';

import type { AiAnnotationNodeResult } from '@/api';
import {
  aiAnnotationReviewReducer,
  createAiAnnotationReviewState,
} from '../aiAnnotationReviewState';

const reviewData: AiAnnotationNodeResult = {
  data: [
    {
      text: 'first row',
      annotation: [{ provider: 'assistant', annotation: 'support' }],
    },
  ],
  columns: ['text', 'annotation'],
  metadata: { annotation_columns: ['annotation'] },
  pagination: {
    page: 1,
    page_size: 5,
    total_source_rows: 1,
    total_source_pages: 1,
    result_count: 1,
    has_next: false,
    has_prev: false,
  },
};

describe('aiAnnotationReviewState', () => {
  it('dedupes added providers and closes the add-annotator dialog', () => {
    let state = createAiAnnotationReviewState();

    state = aiAnnotationReviewReducer(state, { type: 'setAddAnnotatorDialogOpen', open: true });
    state = aiAnnotationReviewReducer(state, { type: 'setNewProviderName', name: ' reviewer ' });
    state = aiAnnotationReviewReducer(state, { type: 'submitNewProvider' });
    state = aiAnnotationReviewReducer(state, { type: 'setNewProviderName', name: 'reviewer' });
    state = aiAnnotationReviewReducer(state, { type: 'submitNewProvider' });

    expect(state.additionalProviders).toEqual(['reviewer']);
    expect(state.newProviderName).toBe('');
    expect(state.isAddAnnotatorDialogOpen).toBe(false);
  });

  it('tracks pending category cells and resets dialog state when closed', () => {
    let state = createAiAnnotationReviewState();
    const pendingCell = {
      row: reviewData.data[0] ?? {},
      rowIndex: 0,
      providerName: 'human',
      annotationColumn: 'annotation',
    };

    state = aiAnnotationReviewReducer(state, { type: 'openAddCategoryDialog', cell: pendingCell });
    expect(state.isAddCategoryDialogOpen).toBe(true);
    expect(state.pendingCategoryCell).toEqual(pendingCell);

    state = aiAnnotationReviewReducer(state, { type: 'setNewCategoryName', name: ' mixed ' });
    state = aiAnnotationReviewReducer(state, { type: 'setAddCategoryDialogOpen', open: false });

    expect(state.isAddCategoryDialogOpen).toBe(false);
    expect(state.pendingCategoryCell).toBeNull();
    expect(state.newCategoryName).toBe('');
  });

  it('patches saved review edits into loaded rows and clears draft/save flags', () => {
    let state = createAiAnnotationReviewState();

    state = aiAnnotationReviewReducer(state, {
      type: 'setReviewData',
      data: reviewData,
    });
    state = aiAnnotationReviewReducer(state, {
      type: 'setReviewNodeId',
      nodeId: 'node-1',
    });
    state = aiAnnotationReviewReducer(state, {
      type: 'setReviewDraft',
      rowIndex: 0,
      providerName: 'human',
      value: 'mixed',
    });
    state = aiAnnotationReviewReducer(state, {
      type: 'setSavingReviewCell',
      editKey: '0::human',
      saving: true,
    });
    state = aiAnnotationReviewReducer(state, {
      type: 'saveReviewEditSucceeded',
      editKey: '0::human',
      rowIndex: 0,
      annotationColumn: 'annotation',
      providerName: 'human',
      annotation: 'mixed',
      defaultPageSize: 5,
    });

    expect(state.reviewData?.data[0]?.annotation).toEqual([
      { provider: 'assistant', annotation: 'support' },
      { provider: 'human', annotation: 'mixed' },
    ]);
    expect(state.reviewEdits).toEqual({});
    expect(state.savingReviewCells).toEqual({});
  });
});
