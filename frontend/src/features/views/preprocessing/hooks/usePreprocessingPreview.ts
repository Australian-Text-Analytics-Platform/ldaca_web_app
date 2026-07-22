import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PreviewPagination, PreviewRow } from '../types';

interface PreviewFetcherResult<Row = PreviewRow> {
  data: Row[];
  columns: string[];
  pagination: PreviewPagination | null;
}

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
 * Used directly by Join and Concat, and by `useNodePreviewWithRawFallback` for
 * operation previews in the remaining preprocessing tabs.
 * Flow: debounce request signatures, bind pagination to the active signature,
 * and let TanStack Query own cancellation, errors, and immutable results.
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

  const [paginationState, setPaginationState] = useState({
    signature: derivedSignature,
    page: initialPage,
    pageSize: initialPageSize,
  });
  const page = paginationState.signature === derivedSignature ? paginationState.page : initialPage;
  const pageSize =
    paginationState.signature === derivedSignature ? paginationState.pageSize : initialPageSize;
  const [debouncedSignature, setDebouncedSignature] = useState('disabled');
  const [refreshKey, setRefreshKey] = useState(0);

  /**
   * Stores pagination with the active request signature to avoid stale pages.
   * Called by the public `setPage` action below.
   */
  const setPaginationDraft = (nextPage: number, nextPageSize: number) => {
    setPaginationState({
      signature: derivedSignature,
      page: nextPage,
      pageSize: nextPageSize,
    });
  };

  /**
   * Updates only the current page while preserving the active page size.
   * Returned to preview tables as `setPage`.
   */
  const setPage = (nextPage: number) => {
    setPaginationDraft(nextPage, pageSize);
  };

  // Debounce only changes Query enablement. Changing identity while a request
  // is active changes the key immediately, so TanStack Query aborts the old
  // request through the signal passed to the operation adapter.
  useEffect(() => {
    if (!ready) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setDebouncedSignature(derivedSignature);
    }, debounceMs);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [debounceMs, derivedSignature, ready]);

  const previewQuery = useQuery({
    queryKey: ['preprocessing-preview', derivedSignature, page, pageSize, refreshKey],
    enabled: ready && debouncedSignature === derivedSignature,
    retry: false,
    queryFn: async ({ signal }): Promise<PreviewFetcherResult<Row>> => {
      if (!request) throw new Error('Preview request is unavailable');
      return fetcher({ request, page, pageSize, signal });
    },
  });

  /**
   * Resets preview paging when consumers choose a different page size.
   * Returned to preview tables as `setPageSize`.
   */
  const handleSetPageSize = (size: number) => {
    setPaginationDraft(initialPage, size);
  };

  /**
   * Forces a refetch without changing the current request or pagination.
   * Returned to feature hooks as the manual `refresh` action.
   */
  const refresh = () => {
    setRefreshKey((current) => current + 1);
  };

  const response = ready ? previewQuery.data : undefined;
  const queryError = previewQuery.error;

  return {
    data: response?.data ?? [],
    columns: response?.columns ?? [],
    pagination: response?.pagination ?? null,
    loading: ready && (debouncedSignature !== derivedSignature || previewQuery.isFetching),
    error:
      ready && queryError
        ? queryError instanceof Error
          ? queryError.message
          : 'Failed to load preview data'
        : null,
    ready,
    page,
    pageSize,
    setPage,
    setPageSize: handleSetPageSize,
    refresh,
  };
};
