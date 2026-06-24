import type { PreviewPagination, PreviewRow } from '../types';

export interface PreviewFetcherResult<Row = PreviewRow> {
  data: Row[];
  columns: string[];
  pagination: PreviewPagination | null;
}

interface PreviewPaginationState {
  signature: string;
  initialPage: number;
  initialPageSize: number;
  page: number;
  pageSize: number;
}

export interface PreviewSignatureContext {
  signature: string;
  initialPage: number;
  initialPageSize: number;
}

export interface PreviewRequestContext extends PreviewSignatureContext {
  page: number;
  pageSize: number;
}

export interface PreprocessingPreviewState<Row = PreviewRow> {
  data: Row[];
  columns: string[];
  pagination: PreviewPagination | null;
  loading: boolean;
  error: string | null;
  refreshKey: number;
  paginationState: PreviewPaginationState;
}

export type PreprocessingPreviewAction<Row = PreviewRow> =
  | { type: 'disabled'; context: PreviewRequestContext }
  | { type: 'loading'; context: PreviewRequestContext }
  | {
      type: 'success';
      context: PreviewRequestContext;
      response: PreviewFetcherResult<Row>;
    }
  | { type: 'error'; message: string }
  | { type: 'set-page'; context: PreviewSignatureContext; page: number; pageSize: number }
  | { type: 'set-page-size'; context: PreviewSignatureContext; pageSize: number }
  | { type: 'refresh' };

/**
 * Converts the active request context into the stored pagination identity.
 * Used by: preprocessingPreviewReducer because pagination has to reset when
 * the request signature or initial paging props change.
 */
const toPaginationState = (context: PreviewRequestContext): PreviewPaginationState => ({
  signature: context.signature,
  initialPage: context.initialPage,
  initialPageSize: context.initialPageSize,
  page: context.page,
  pageSize: context.pageSize,
});

/**
 * Builds the hook's initial state from the first request signature.
 * Used by: usePreprocessingPreview reducer initialization so initial pagination
 * and preview result fields start from one consistent state object.
 */
export const createPreprocessingPreviewState = <Row = PreviewRow>(
  context: PreviewSignatureContext,
): PreprocessingPreviewState<Row> => ({
  data: [],
  columns: [],
  pagination: null,
  loading: false,
  error: null,
  refreshKey: 0,
  paginationState: {
    signature: context.signature,
    initialPage: context.initialPage,
    initialPageSize: context.initialPageSize,
    page: context.initialPage,
    pageSize: context.initialPageSize,
  },
});

/**
 * Returns the page/page-size pair that belongs to the active request
 * signature. Used by: usePreprocessingPreview before scheduling each preview
 * fetch so stale pages from a previous request do not leak into a new one.
 */
export const resolvePreviewPaging = <Row = PreviewRow>(
  state: PreprocessingPreviewState<Row>,
  context: PreviewSignatureContext,
) => {
  const isCurrent =
    state.paginationState.signature === context.signature &&
    state.paginationState.initialPage === context.initialPage &&
    state.paginationState.initialPageSize === context.initialPageSize;

  return {
    page: isCurrent ? state.paginationState.page : context.initialPage,
    pageSize: isCurrent ? state.paginationState.pageSize : context.initialPageSize,
  };
};

/**
 * Owns the shared preprocessing preview state machine.
 * Used by: usePreprocessingPreview because every preprocessing subtab needs the
 * same loading, disabled, success, error, refresh, and pagination semantics.
 * Flow: keep stale data visible during loading, clear data on disabled/error,
 * normalize malformed successful responses, and bind paging to the active
 * request signature.
 */
export const preprocessingPreviewReducer = <Row = PreviewRow>(
  state: PreprocessingPreviewState<Row>,
  action: PreprocessingPreviewAction<Row>,
): PreprocessingPreviewState<Row> => {
  switch (action.type) {
    case 'disabled':
      return {
        ...state,
        data: [],
        columns: [],
        pagination: null,
        loading: false,
        error: null,
        paginationState: toPaginationState(action.context),
      };

    case 'loading':
      return {
        ...state,
        loading: true,
        error: null,
        paginationState: toPaginationState(action.context),
      };

    case 'success': {
      const pagination = action.response.pagination ?? null;
      const serverPage = pagination?.page ?? action.context.page;
      return {
        ...state,
        data: Array.isArray(action.response.data) ? action.response.data : [],
        columns: Array.isArray(action.response.columns) ? action.response.columns : [],
        pagination,
        loading: false,
        error: null,
        paginationState: toPaginationState({
          ...action.context,
          page: serverPage,
        }),
      };
    }

    case 'error':
      return {
        ...state,
        data: [],
        columns: [],
        pagination: null,
        loading: false,
        error: action.message,
      };

    case 'set-page':
      return {
        ...state,
        paginationState: {
          signature: action.context.signature,
          initialPage: action.context.initialPage,
          initialPageSize: action.context.initialPageSize,
          page: action.page,
          pageSize: action.pageSize,
        },
      };

    case 'set-page-size':
      return {
        ...state,
        paginationState: {
          signature: action.context.signature,
          initialPage: action.context.initialPage,
          initialPageSize: action.context.initialPageSize,
          page: action.context.initialPage,
          pageSize: action.pageSize,
        },
      };

    case 'refresh':
      return { ...state, refreshKey: state.refreshKey + 1 };
  }
};
