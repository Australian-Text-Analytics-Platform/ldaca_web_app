import { useEffect, useReducer } from 'react';

import {
  getAiAnnotationCategories,
  getAiAnnotationProviders,
  getNodeData,
  saveAiAnnotation,
} from '@/api';
import type { AiAnnotationNodeResult } from '@/api';
import { buildAiAnnotationEditKey, getPersistedAiAnnotationValue } from './aiAnnotationReviewModel';
import {
  aiAnnotationReviewReducer,
  createAiAnnotationReviewState,
} from './aiAnnotationReviewState';

interface UseAiAnnotationReviewWorkflowArgs {
  currentWorkspaceId: string | null;
  selectedNodeId: string | null;
  getAuthHeaders: () => Record<string, string>;
  setStatusMessage: (message: string) => void;
  defaultPageSize?: number;
}

const DEFAULT_REVIEW_PAGE_SIZE = 5;

/** Dedupes backend-provided annotation labels while preserving first-seen order. */
/**
 * Called by: useAiAnnotationReviewWorkflow after provider/category API calls because the review UI should not render duplicate select choices or provider columns.
 */
const uniqueTrimmed = (values: string[]) =>
  Array.from(new Set(values.map((name) => name.trim()).filter(Boolean)));

/**
 * Owns the AI annotator review tab workflow: selected review columns, loaded
 * row page, provider/category caches, draft edits, autosave flags, and the two
 * add dialogs.
 * Used by: AiAnnotatorFeature because the feature should wire UI controls and
 * table rendering while this hook coordinates review-specific state and API
 * side effects.
 * Flow: choose review columns, load row/provider/category data for the selected
 * node, keep draft edits keyed by row/provider, autosave changed cells, update
 * the loaded page locally after save, and reset transient dialog state when
 * dialogs close.
 */
export function useAiAnnotationReviewWorkflow({
  currentWorkspaceId,
  selectedNodeId,
  getAuthHeaders,
  setStatusMessage,
  defaultPageSize = DEFAULT_REVIEW_PAGE_SIZE,
}: UseAiAnnotationReviewWorkflowArgs) {
  const [reviewState, dispatchReview] = useReducer(
    aiAnnotationReviewReducer,
    undefined,
    createAiAnnotationReviewState,
  );
  const {
    reviewTextColumn,
    reviewAnnotationColumn,
    reviewData,
    reviewNodeId,
    isReviewLoading,
    isReviewPaging,
    reviewGlobalProviders,
    reviewGlobalCategories,
    temporaryCategories,
    reviewEdits,
    savingReviewCells,
    additionalProviders,
    newProviderName,
    isAddAnnotatorDialogOpen,
    isAddCategoryDialogOpen,
    newCategoryName,
    pendingCategoryCell,
  } = reviewState;

  const setReviewTextColumn = (column: string) => {
    dispatchReview({ type: 'setReviewTextColumn', column });
  };
  const setReviewAnnotationColumn = (column: string) => {
    dispatchReview({ type: 'setReviewAnnotationColumn', column });
  };
  const setReviewData = (data: AiAnnotationNodeResult | null) => {
    dispatchReview({ type: 'setReviewData', data });
  };
  const setReviewNodeId = (nodeId: string | null) => {
    dispatchReview({ type: 'setReviewNodeId', nodeId });
  };
  const setNewProviderName = (name: string) => {
    dispatchReview({ type: 'setNewProviderName', name });
  };
  const setIsAddAnnotatorDialogOpen = (open: boolean) => {
    dispatchReview({ type: 'setAddAnnotatorDialogOpen', open });
  };
  const setNewCategoryName = (name: string) => {
    dispatchReview({ type: 'setNewCategoryName', name });
  };

  /** Records an in-progress review edit before the blur/select handler attempts to persist it. */
  /**
   * Called by: review table controls because the visible select value should update immediately while saveAiAnnotation is still pending.
   */
  const handleReviewValueChange = (rowIndex: number, providerName: string, value: string) => {
    dispatchReview({ type: 'setReviewDraft', rowIndex, providerName, value });
  };

  /** Adds a reviewer-defined provider name to the editable review grid. */
  /**
   * Called by: the add-annotator dialog because users can create a local provider column before any backend row has that provider.
   */
  const handleAddProvider = () => {
    dispatchReview({ type: 'submitNewProvider' });
  };

  /** Loads source rows for the review tab while adapting node-data pagination to annotation metadata. */
  /**
   * Called by: handleReview and review pagination because both paths need the same node-data-to-review-result normalization.
   * Flow: fetch a node data page, wrap it in the AiAnnotationNodeResult shape expected by the existing review table, then mark which node is being reviewed.
   */
  const loadReviewPage = async (
    nodeId: string,
    _textColumn: string,
    annotationColumn: string,
    page: number,
    pageSize: number,
  ) => {
    dispatchReview({ type: 'setReviewPaging', paging: true });
    try {
      const { data: response } = await getNodeData({
        headers: getAuthHeaders(),
        path: { node_id: nodeId },
        query: { page, page_size: pageSize },
        throwOnError: true,
      });
      const rows = response.data;
      const pagination = response.pagination;
      dispatchReview({
        type: 'setReviewData',
        data: {
          data: rows,
          columns: response.columns,
          metadata: { annotation_columns: [annotationColumn] },
          pagination: {
            page: pagination.page,
            page_size: pagination.page_size,
            total_source_rows: pagination.total_rows,
            total_source_pages: pagination.total_pages,
            result_count: rows.length,
            has_next: pagination.has_next,
            has_prev: pagination.has_prev,
          },
        },
      });
      dispatchReview({ type: 'setReviewNodeId', nodeId });
      setStatusMessage('Review data loaded.');
    } catch (error) {
      setStatusMessage(
        `Failed to load review data: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      dispatchReview({ type: 'setReviewPaging', paging: false });
    }
  };

  /** Retrieves provider names already present in the selected annotation column. */
  /**
   * Called by: handleReview and review pagination because provider columns should track backend-stored annotators for the selected annotation column.
   */
  const loadReviewProviders = async (nodeId: string, annotationColumn: string) => {
    try {
      const { data: response } = await getAiAnnotationProviders({
        headers: getAuthHeaders(),
        path: { node_id: nodeId },
        query: { annotation_column: annotationColumn },
        throwOnError: true,
      });
      dispatchReview({
        type: 'setReviewGlobalProviders',
        providers: uniqueTrimmed(response.data.providers),
      });
    } catch (error) {
      setStatusMessage(
        `Failed to load annotators: ${error instanceof Error ? error.message : String(error)}`,
      );
      dispatchReview({ type: 'setReviewGlobalProviders', providers: [] });
    }
  };

  /** Retrieves saved annotation categories so the review select stays aligned with existing data. */
  /**
   * Called by: refreshCategoryCache because category options combine backend-known labels with current page and local temporary labels.
   */
  const loadReviewCategories = async (nodeId: string, annotationColumn: string) => {
    try {
      const { data: response } = await getAiAnnotationCategories({
        headers: getAuthHeaders(),
        path: { node_id: nodeId },
        query: { annotation_column: annotationColumn },
        throwOnError: true,
      });
      dispatchReview({
        type: 'setReviewGlobalCategories',
        categories: uniqueTrimmed(response.data.categories),
      });
    } catch (error) {
      setStatusMessage(
        `Failed to load annotation categories: ${error instanceof Error ? error.message : String(error)}`,
      );
      dispatchReview({ type: 'setReviewGlobalCategories', categories: [] });
    }
  };

  /** Refreshes backend category options after local category state might have become stale. */
  /**
   * Called by: handleReview and review pagination because moving to a new page should rebuild the category menu from backend data plus page-discovered labels.
   */
  const refreshCategoryCache = async (nodeId: string, annotationColumn: string) => {
    dispatchReview({ type: 'resetCategoryCache' });
    await loadReviewCategories(nodeId, annotationColumn);
  };

  /** Opens the review workflow by loading rows, providers, and categories in parallel. */
  /**
   * Called by: the Review action in AiAnnotatorFeature. Flow: validate selected node/columns, set the busy flag, load page/provider/category data, then clear the busy flag.
   */
  const handleReview = async () => {
    if (!selectedNodeId || !reviewTextColumn || !reviewAnnotationColumn) {
      setStatusMessage('Select a data block, text column, and annotation column to review.');
      return;
    }
    dispatchReview({ type: 'setReviewLoading', loading: true });
    try {
      await Promise.all([
        loadReviewPage(
          selectedNodeId,
          reviewTextColumn,
          reviewAnnotationColumn,
          1,
          defaultPageSize,
        ),
        loadReviewProviders(selectedNodeId, reviewAnnotationColumn),
        refreshCategoryCache(selectedNodeId, reviewAnnotationColumn),
      ]);
    } finally {
      dispatchReview({ type: 'setReviewLoading', loading: false });
    }
  };

  /** Auto-saves a review cell when its draft differs from the persisted annotation value. */
  /**
   * Called by: category selects and add-category confirmation because every review edit should persist through the same backend endpoint and local row update path.
   * Flow: skip unchanged or already-saving cells, save the edited provider/category pair, patch the loaded page in place, then clear draft/save flags.
   */
  const handleReviewInputBlur = async (
    row: Record<string, unknown>,
    rowIndex: number,
    providerName: string,
    annotationColumn: string,
    nextValue: string,
  ) => {
    if (!reviewNodeId || !reviewAnnotationColumn) {
      return;
    }

    const editKey = buildAiAnnotationEditKey(rowIndex, providerName);
    const persistedValue = getPersistedAiAnnotationValue(row, providerName, annotationColumn);

    if (nextValue === persistedValue) {
      dispatchReview({ type: 'clearReviewDraft', editKey });
      return;
    }

    if (savingReviewCells[editKey]) {
      return;
    }

    dispatchReview({ type: 'setSavingReviewCell', editKey, saving: true });
    try {
      await saveAiAnnotation({
        body: {
          annotation_column: reviewAnnotationColumn,
          edits: [{ row_index: rowIndex, provider: providerName, annotation: nextValue }],
        },
        headers: getAuthHeaders(),
        path: { node_id: reviewNodeId },
        throwOnError: true,
      });

      dispatchReview({
        type: 'saveReviewEditSucceeded',
        editKey,
        rowIndex,
        annotationColumn,
        providerName,
        annotation: nextValue,
        defaultPageSize,
      });
    } catch (error) {
      setStatusMessage(
        `Failed to auto-save review edit: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      dispatchReview({ type: 'setSavingReviewCell', editKey, saving: false });
    }
  };

  /** Applies a category menu choice, including the sentinel that opens the add-category dialog. */
  /**
   * Called by: each review cell select because the sentinel opens a dialog while real category values save immediately.
   */
  const handleCategorySelected = async (
    row: Record<string, unknown>,
    rowIndex: number,
    providerName: string,
    annotationColumn: string,
    selectedValue: string,
  ) => {
    if (selectedValue === '__add_new_category__') {
      dispatchReview({
        type: 'openAddCategoryDialog',
        cell: { row, rowIndex, providerName, annotationColumn },
      });
      return;
    }

    const nextValue = selectedValue === '__empty__' ? '' : selectedValue;
    handleReviewValueChange(rowIndex, providerName, nextValue);
    await handleReviewInputBlur(row, rowIndex, providerName, annotationColumn, nextValue);
  };

  /** Commits a newly named category to the pending review cell and persists the edit. */
  /**
   * Called by: the add-category dialog confirm action because category creation is local UI state plus a normal review-cell save.
   */
  const handleConfirmAddCategory = async () => {
    const name = newCategoryName.trim();
    if (!name || !pendingCategoryCell) {
      return;
    }

    dispatchReview({ type: 'addTemporaryCategory', name });
    handleReviewValueChange(pendingCategoryCell.rowIndex, pendingCategoryCell.providerName, name);
    await handleReviewInputBlur(
      pendingCategoryCell.row,
      pendingCategoryCell.rowIndex,
      pendingCategoryCell.providerName,
      pendingCategoryCell.annotationColumn,
      name,
    );

    dispatchReview({ type: 'setAddCategoryDialogOpen', open: false });
  };

  /** Handles add-category dialog visibility and resets incomplete dialog input on close. */
  /**
   * Called by: AlertDialog onOpenChange because closing the modal should clear the pending target cell and typed category name.
   */
  const handleAddCategoryDialogOpenChange = (open: boolean) => {
    dispatchReview({ type: 'setAddCategoryDialogOpen', open });
  };

  useEffect(() => {
    void Promise.resolve().then(() => {
      dispatchReview({ type: 'clearAllReviewDrafts' });
    });
  }, [
    reviewNodeId,
    reviewAnnotationColumn,
    reviewData?.pagination?.page,
    reviewData?.pagination?.page_size,
  ]);

  const reviewRunDisabled =
    !currentWorkspaceId ||
    !selectedNodeId ||
    !reviewTextColumn ||
    !reviewAnnotationColumn ||
    isReviewLoading;

  const reviewPagination = reviewData?.pagination;
  const reviewPageNum = reviewPagination?.page ?? 1;
  const reviewPageSizeNum = reviewPagination?.page_size ?? defaultPageSize;

  return {
    reviewTextColumn,
    setReviewTextColumn,
    reviewAnnotationColumn,
    setReviewAnnotationColumn,
    reviewData,
    setReviewData,
    reviewNodeId,
    setReviewNodeId,
    isReviewLoading,
    isReviewPaging,
    reviewGlobalProviders,
    reviewGlobalCategories,
    temporaryCategories,
    reviewEdits,
    savingReviewCells,
    additionalProviders,
    newProviderName,
    setNewProviderName,
    isAddAnnotatorDialogOpen,
    setIsAddAnnotatorDialogOpen,
    isAddCategoryDialogOpen,
    handleAddCategoryDialogOpenChange,
    newCategoryName,
    setNewCategoryName,
    reviewRunDisabled,
    reviewPagination,
    reviewPageNum,
    reviewPageSizeNum,
    handleAddProvider,
    loadReviewPage,
    loadReviewProviders,
    refreshCategoryCache,
    handleReview,
    handleCategorySelected,
    handleConfirmAddCategory,
  };
}
