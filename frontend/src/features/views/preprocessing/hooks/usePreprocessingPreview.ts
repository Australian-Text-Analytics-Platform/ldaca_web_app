import { useEffect, useEffectEvent, useReducer } from 'react';
import type { PreviewPagination, PreviewRow } from '../types';
import {
  createPreprocessingPreviewState,
  preprocessingPreviewReducer,
  resolvePreviewPaging,
  type PreviewFetcherResult,
  type PreviewSignatureContext,
} from './preprocessingPreviewState';

export interface UsePreprocessingPreviewOptions<RequestPayload, Row = PreviewRow> {
  /** The fully prepared request payload required by the preview endpoint. */
  request: RequestPayload | null;
  /** Whether previews should be attempted. Defaults to `true`. */
  enabled?: boolean;
  /** Optional operation prefix; the complete serialized request is always appended. */
  signature?: string;
  /** Debounce delay (ms) before firing the preview request. Defaults to 600ms. */
  debounceMs?: number;
  /** Initial page number (1-indexed). Defaults to 1. */
  initialPage?: number;
  /** Initial preview page size. Defaults to 10. */
  initialPageSize?: number;
  /** Callback that performs the actual preview fetch. */
  fetcher: (params: {
    request: RequestPayload;
    page: number;
    pageSize: number;
    signal: AbortSignal;
  }) => Promise<PreviewFetcherResult<Row>>;
}

export interface UsePreprocessingPreviewResult<Row = PreviewRow> {
  data: Row[];
  columns: string[];
  pagination: PreviewPagination | null;
  loading: boolean;
  error: string | null;
  ready: boolean;
  page: number;
  pageSize: number;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
  refresh: () => void;
}

const DEFAULT_DEBOUNCE_MS = 600;
const DEFAULT_PAGE_SIZE = 10;

/**
 * Shared debounced preview loader for preprocessing tabs. Operation-specific
 * hooks supply the request and fetcher so pagination, cancellation, loading,
 * and error state behave consistently across tabs.
 * Used by: useJoinSubTab hook, useNodePreviewWithRawFallback hook, useConcatSubTab hook (rg call sites/imports) because those callers need a shared helper boundary for consistent feature state, formatting, or request payloads.
 * Flow: debounce request signatures, bind pagination to the active signature,
 * call the latest provided fetcher through a React effect event, and drop
 * stale responses through effect cleanup.
 */
export const usePreprocessingPreview = <RequestPayload, Row = PreviewRow>(
  options: UsePreprocessingPreviewOptions<RequestPayload, Row>,
): UsePreprocessingPreviewResult<Row> => {
  const {
    request,
    enabled = true,
    signature,
    debounceMs = DEFAULT_DEBOUNCE_MS,
    initialPage = 1,
    initialPageSize = DEFAULT_PAGE_SIZE,
    fetcher,
  } = options;

  const ready = Boolean(enabled && request);
  const derivedSignature = (() => {
    if (!ready || !request) return 'disabled';
    try {
      const requestSignature = JSON.stringify(request);
      return signature ? `${signature}::${requestSignature}` : requestSignature;
    } catch {
      return signature
        ? `${signature}::preview-signature-unserializable`
        : 'preview-signature-unserializable';
    }
  })();

  const signatureContext: PreviewSignatureContext = {
    signature: derivedSignature,
    initialPage,
    initialPageSize,
  };

  const [state, dispatch] = useReducer(
    preprocessingPreviewReducer<Row>,
    createPreprocessingPreviewState<Row>(signatureContext),
  );
  const { page, pageSize } = resolvePreviewPaging(state, signatureContext);

  /**
   * Stores pagination with the active request signature to avoid stale pages.
   * Called by: usePreprocessingPreview internal event, effect, or helper flow.
   */
  const setPaginationDraft = (nextPage: number, nextPageSize: number) => {
    dispatch({
      type: 'set-page',
      context: signatureContext,
      page: nextPage,
      pageSize: nextPageSize,
    });
  };

  /**
   * Updates only the current page while preserving the active page size.
   * Called by: usePreprocessingPreview internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const setPage = (nextPage: number) => {
    setPaginationDraft(nextPage, pageSize);
  };

  // React 19 effect events let the scheduled fetch read the latest request and
  // fetcher without making inline caller callbacks restart the debounce.
  const fetchPreview = useEffectEvent(
    async (
      context: {
        page: number;
        pageSize: number;
      },
      signal: AbortSignal,
    ) => {
      if (!request) return null;
      return fetcher({ request, page: context.page, pageSize: context.pageSize, signal });
    },
  );

  // Debounced preview fetcher shared by all preprocessing operations.
  useEffect(() => {
    const context = {
      signature: derivedSignature,
      initialPage,
      initialPageSize,
      page,
      pageSize,
    };

    if (!ready) {
      dispatch({ type: 'disabled', context });
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    dispatch({ type: 'loading', context });

    const timeoutId = window.setTimeout(() => {
      void fetchPreview(context, controller.signal)
        .then((response) => {
          if (cancelled || !response) return;
          dispatch({ type: 'success', response, context });
        })
        .catch((err: unknown) => {
          if (cancelled || controller.signal.aborted) return;
          const message = err instanceof Error ? err.message : 'Failed to load preview data';
          dispatch({ type: 'error', message });
        });
    }, debounceMs);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [
    ready,
    page,
    pageSize,
    debounceMs,
    state.refreshKey,
    derivedSignature,
    initialPage,
    initialPageSize,
  ]);

  /**
   * Resets preview paging when consumers choose a different page size.
   * Called by: usePreprocessingPreview internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const handleSetPageSize = (size: number) => {
    dispatch({ type: 'set-page-size', context: signatureContext, pageSize: size });
  };

  /**
   * Forces a refetch without changing the current request or pagination.
   * Called by: usePreprocessingPreview internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const refresh = () => {
    dispatch({ type: 'refresh' });
  };

  return {
    data: state.data,
    columns: state.columns,
    pagination: state.pagination,
    loading: state.loading,
    error: state.error,
    ready,
    page,
    pageSize,
    setPage,
    setPageSize: handleSetPageSize,
    refresh,
  };
};
