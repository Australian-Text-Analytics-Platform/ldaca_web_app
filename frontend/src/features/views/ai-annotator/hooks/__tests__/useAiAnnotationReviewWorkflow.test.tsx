import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getAiAnnotationCategories,
  getAiAnnotationProviders,
  getNodeData,
  saveAiAnnotation,
} from '@/api';
import { useAiAnnotationReviewWorkflow } from '../useAiAnnotationReviewWorkflow';

vi.mock('@/api', () => ({
  getAiAnnotationCategories: vi.fn(),
  getAiAnnotationProviders: vi.fn(),
  getNodeData: vi.fn(),
  saveAiAnnotation: vi.fn(),
}));

const mockedGetNodeData = vi.mocked(getNodeData);
const mockedGetAiAnnotationProviders = vi.mocked(getAiAnnotationProviders);
const mockedGetAiAnnotationCategories = vi.mocked(getAiAnnotationCategories);
const mockedSaveAiAnnotation = vi.mocked(saveAiAnnotation);

const getAuthHeaders = vi.fn(() => ({ authorization: 'Bearer test-token' }));
const setStatusMessage = vi.fn();

const baseArgs = {
  currentWorkspaceId: 'workspace-1',
  selectedNodeId: 'node-1',
  getAuthHeaders,
  setStatusMessage,
};

describe('useAiAnnotationReviewWorkflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetNodeData.mockResolvedValue({
      data: {
        columns: ['text', 'annotation'],
        data: [
          {
            text: 'first row',
            annotation: [{ provider: 'assistant', annotation: 'support' }],
          },
        ],
        dtypes: { text: 'string', annotation: 'annotation' },
        filtering: { op: '' },
        pagination: {
          page: 1,
          page_size: 5,
          total_rows: 1,
          total_pages: 1,
          has_next: false,
          has_prev: false,
        },
        sorting: { sort_by: null, descending: false },
      },
      error: undefined,
    });
    mockedGetAiAnnotationProviders.mockResolvedValue({
      data: {
        state: 'successful',
        message: 'ok',
        data: { providers: [' assistant ', 'human', 'assistant'] },
      },
      error: undefined,
    });
    mockedGetAiAnnotationCategories.mockResolvedValue({
      data: {
        state: 'successful',
        message: 'ok',
        data: { categories: ['support', 'critical', 'support'] },
      },
      error: undefined,
    });
    mockedSaveAiAnnotation.mockResolvedValue({
      data: {
        state: 'successful',
        message: 'saved',
        data: { annotation_column: 'annotation', edits_applied: 1 },
      },
      error: undefined,
    });
  });

  it('loads review rows, providers, and categories for the selected node and columns', async () => {
    const { result } = renderHook(() => useAiAnnotationReviewWorkflow(baseArgs));

    act(() => {
      result.current.setReviewTextColumn('text');
      result.current.setReviewAnnotationColumn('annotation');
    });

    await act(async () => {
      await result.current.handleReview();
    });

    expect(mockedGetNodeData).toHaveBeenCalledWith({
      headers: { authorization: 'Bearer test-token' },
      path: { node_id: 'node-1' },
      query: { page: 1, page_size: 5 },
      throwOnError: true,
    });
    expect(mockedGetAiAnnotationProviders).toHaveBeenCalledWith({
      headers: { authorization: 'Bearer test-token' },
      path: { node_id: 'node-1' },
      query: { annotation_column: 'annotation' },
      throwOnError: true,
    });
    expect(result.current.reviewData?.metadata?.annotation_columns).toEqual(['annotation']);
    expect(result.current.reviewNodeId).toBe('node-1');
    expect(result.current.reviewGlobalProviders).toEqual(['assistant', 'human']);
    expect(result.current.reviewGlobalCategories).toEqual(['support', 'critical']);
    expect(setStatusMessage).toHaveBeenCalledWith('Review data loaded.');
  });

  it('dedupes added providers and closes the add-annotator dialog', () => {
    const { result } = renderHook(() => useAiAnnotationReviewWorkflow(baseArgs));

    act(() => {
      result.current.setIsAddAnnotatorDialogOpen(true);
      result.current.setNewProviderName(' reviewer ');
    });
    act(() => {
      result.current.handleAddProvider();
    });
    act(() => {
      result.current.setNewProviderName('reviewer');
    });
    act(() => {
      result.current.handleAddProvider();
    });

    expect(result.current.additionalProviders).toEqual(['reviewer']);
    expect(result.current.newProviderName).toBe('');
    expect(result.current.isAddAnnotatorDialogOpen).toBe(false);
  });

  it('opens the add-category dialog from the sentinel and saves the confirmed category', async () => {
    const { result } = renderHook(() => useAiAnnotationReviewWorkflow(baseArgs));

    act(() => {
      result.current.setReviewAnnotationColumn('annotation');
      result.current.setReviewData({
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
      });
      result.current.setReviewNodeId('node-1');
    });

    await act(async () => {
      await result.current.handleCategorySelected(
        result.current.reviewData?.data[0] ?? {},
        0,
        'human',
        'annotation',
        '__add_new_category__',
      );
    });

    expect(result.current.isAddCategoryDialogOpen).toBe(true);

    act(() => {
      result.current.setNewCategoryName('mixed');
    });

    await act(async () => {
      await result.current.handleConfirmAddCategory();
    });

    expect(mockedSaveAiAnnotation).toHaveBeenCalledWith({
      body: {
        annotation_column: 'annotation',
        edits: [{ row_index: 0, provider: 'human', annotation: 'mixed' }],
      },
      headers: { authorization: 'Bearer test-token' },
      path: { node_id: 'node-1' },
      throwOnError: true,
    });
    expect(result.current.temporaryCategories).toEqual(['mixed']);
    expect(result.current.reviewData?.data[0]?.annotation).toEqual([
      { provider: 'assistant', annotation: 'support' },
      { provider: 'human', annotation: 'mixed' },
    ]);
    expect(result.current.isAddCategoryDialogOpen).toBe(false);
  });
});
