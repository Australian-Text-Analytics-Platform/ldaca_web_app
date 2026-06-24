import type { AiAnnotationNodeResult } from '@/api';
import {
  applyAiAnnotationReviewEditToRows,
  buildAiAnnotationEditKey,
} from './aiAnnotationReviewModel';

interface PendingCategoryCell {
  row: Record<string, unknown>;
  rowIndex: number;
  providerName: string;
  annotationColumn: string;
}

export interface AiAnnotationReviewState {
  reviewTextColumn: string;
  reviewAnnotationColumn: string;
  reviewData: AiAnnotationNodeResult | null;
  reviewNodeId: string | null;
  isReviewLoading: boolean;
  isReviewPaging: boolean;
  reviewGlobalProviders: string[];
  reviewGlobalCategories: string[];
  temporaryCategories: string[];
  reviewEdits: Record<string, string>;
  savingReviewCells: Record<string, boolean>;
  additionalProviders: string[];
  newProviderName: string;
  isAddAnnotatorDialogOpen: boolean;
  isAddCategoryDialogOpen: boolean;
  newCategoryName: string;
  pendingCategoryCell: PendingCategoryCell | null;
}

export type AiAnnotationReviewAction =
  | { type: 'setReviewTextColumn'; column: string }
  | { type: 'setReviewAnnotationColumn'; column: string }
  | { type: 'setReviewData'; data: AiAnnotationNodeResult | null }
  | { type: 'setReviewNodeId'; nodeId: string | null }
  | { type: 'setReviewLoading'; loading: boolean }
  | { type: 'setReviewPaging'; paging: boolean }
  | { type: 'setReviewGlobalProviders'; providers: string[] }
  | { type: 'setReviewGlobalCategories'; categories: string[] }
  | { type: 'resetCategoryCache' }
  | { type: 'setNewProviderName'; name: string }
  | { type: 'setAddAnnotatorDialogOpen'; open: boolean }
  | { type: 'submitNewProvider' }
  | { type: 'setReviewDraft'; rowIndex: number; providerName: string; value: string }
  | { type: 'clearReviewDraft'; editKey: string }
  | { type: 'clearAllReviewDrafts' }
  | { type: 'setSavingReviewCell'; editKey: string; saving: boolean }
  | { type: 'openAddCategoryDialog'; cell: PendingCategoryCell }
  | { type: 'setAddCategoryDialogOpen'; open: boolean }
  | { type: 'setNewCategoryName'; name: string }
  | { type: 'addTemporaryCategory'; name: string }
  | {
      type: 'saveReviewEditSucceeded';
      editKey: string;
      rowIndex: number;
      annotationColumn: string;
      providerName: string;
      annotation: string;
      defaultPageSize: number;
    };

/**
 * Builds the reducer's initial AI annotation review state.
 * Used by: useAiAnnotationReviewWorkflow and reducer tests so the hook starts
 * from one documented state shape instead of many unrelated useState calls.
 */
export function createAiAnnotationReviewState(): AiAnnotationReviewState {
  return {
    reviewTextColumn: '',
    reviewAnnotationColumn: '',
    reviewData: null,
    reviewNodeId: null,
    isReviewLoading: false,
    isReviewPaging: false,
    reviewGlobalProviders: [],
    reviewGlobalCategories: [],
    temporaryCategories: [],
    reviewEdits: {},
    savingReviewCells: {},
    additionalProviders: [],
    newProviderName: '',
    isAddAnnotatorDialogOpen: false,
    isAddCategoryDialogOpen: false,
    newCategoryName: '',
    pendingCategoryCell: null,
  };
}

/**
 * Removes one keyed value from a record without mutating the input object.
 * Called by: aiAnnotationReviewReducer when draft edits or save flags should
 * disappear after no-op edits, successful saves, or failed save cleanup.
 */
function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!Object.prototype.hasOwnProperty.call(record, key)) {
    return record;
  }
  const { [key]: _removed, ...rest } = record;
  void _removed;
  return rest;
}

/**
 * Centralizes AI annotation review state transitions.
 * Used by: useAiAnnotationReviewWorkflow so review page loading, provider and
 * category caches, draft edits, saving flags, and add dialogs move together as
 * explicit product events instead of scattered state setters.
 * Flow: reduce one event into the next immutable state, preserving row-patching
 * behavior by reusing aiAnnotationReviewModel helpers.
 */
export function aiAnnotationReviewReducer(
  state: AiAnnotationReviewState,
  action: AiAnnotationReviewAction,
): AiAnnotationReviewState {
  switch (action.type) {
    case 'setReviewTextColumn':
      return { ...state, reviewTextColumn: action.column };
    case 'setReviewAnnotationColumn':
      return { ...state, reviewAnnotationColumn: action.column };
    case 'setReviewData':
      return { ...state, reviewData: action.data };
    case 'setReviewNodeId':
      return { ...state, reviewNodeId: action.nodeId };
    case 'setReviewLoading':
      return { ...state, isReviewLoading: action.loading };
    case 'setReviewPaging':
      return { ...state, isReviewPaging: action.paging };
    case 'setReviewGlobalProviders':
      return { ...state, reviewGlobalProviders: action.providers };
    case 'setReviewGlobalCategories':
      return { ...state, reviewGlobalCategories: action.categories };
    case 'resetCategoryCache':
      return { ...state, temporaryCategories: [], reviewGlobalCategories: [] };
    case 'setNewProviderName':
      return { ...state, newProviderName: action.name };
    case 'setAddAnnotatorDialogOpen':
      return { ...state, isAddAnnotatorDialogOpen: action.open };
    case 'submitNewProvider': {
      const name = state.newProviderName.trim();
      if (!name) {
        return state;
      }
      return {
        ...state,
        additionalProviders: state.additionalProviders.includes(name)
          ? state.additionalProviders
          : [...state.additionalProviders, name],
        newProviderName: '',
        isAddAnnotatorDialogOpen: false,
      };
    }
    case 'setReviewDraft':
      return {
        ...state,
        reviewEdits: {
          ...state.reviewEdits,
          [buildAiAnnotationEditKey(action.rowIndex, action.providerName)]: action.value,
        },
      };
    case 'clearReviewDraft':
      return { ...state, reviewEdits: omitKey(state.reviewEdits, action.editKey) };
    case 'clearAllReviewDrafts':
      return { ...state, reviewEdits: {} };
    case 'setSavingReviewCell': {
      if (!action.saving) {
        return { ...state, savingReviewCells: omitKey(state.savingReviewCells, action.editKey) };
      }
      return {
        ...state,
        savingReviewCells: { ...state.savingReviewCells, [action.editKey]: true },
      };
    }
    case 'openAddCategoryDialog':
      return {
        ...state,
        pendingCategoryCell: action.cell,
        newCategoryName: '',
        isAddCategoryDialogOpen: true,
      };
    case 'setAddCategoryDialogOpen':
      return action.open
        ? { ...state, isAddCategoryDialogOpen: true }
        : {
            ...state,
            isAddCategoryDialogOpen: false,
            pendingCategoryCell: null,
            newCategoryName: '',
          };
    case 'setNewCategoryName':
      return { ...state, newCategoryName: action.name };
    case 'addTemporaryCategory': {
      const name = action.name.trim();
      if (!name || state.temporaryCategories.includes(name)) {
        return state;
      }
      return { ...state, temporaryCategories: [...state.temporaryCategories, name] };
    }
    case 'saveReviewEditSucceeded': {
      const pagination = state.reviewData?.pagination;
      const currentPage = pagination?.page ?? 1;
      const currentPageSize = pagination?.page_size ?? action.defaultPageSize;
      return {
        ...state,
        reviewData: state.reviewData
          ? {
              ...state.reviewData,
              data: applyAiAnnotationReviewEditToRows({
                rows: state.reviewData.data,
                page: currentPage,
                pageSize: currentPageSize,
                rowIndex: action.rowIndex,
                annotationColumn: action.annotationColumn,
                providerName: action.providerName,
                annotation: action.annotation,
              }),
            }
          : state.reviewData,
        reviewEdits: omitKey(state.reviewEdits, action.editKey),
        savingReviewCells: omitKey(state.savingReviewCells, action.editKey),
      };
    }
    default:
      return state;
  }
}
