import { useEffect, useState } from 'react';
import { hashKey, useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import type { PreviewPagination, PreviewRow } from '../types';

interface PreviewFetcherResult<Row = PreviewRow> {
  data: Row[];
  columns: string[];
  pagination: PreviewPagination | null;
}

export interface UsePreprocessingPreviewOptions<RequestPayload, Row = PreviewRow> {
  /** The fully prepared request payload required by the preview endpoint. */
  request: RequestPayload | null;
  /** Stable resource identity used for targeted invalidation. */
  identity: {
    workspaceId: string;
    operation: string;
    nodeIds: readonly string[];
  } | null;
  /** Whether previews should be attempted. Defaults to `true`. */
  enabled?: boolean;
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
 * Flow: debounce structured request identities, bind pagination to the active request,
 * and let TanStack Query own cancellation, errors, and immutable results.
 */
export const usePreprocessingPreview = <RequestPayload, Row = PreviewRow>(
  options: UsePreprocessingPreviewOptions<RequestPayload, Row>,
): UsePreprocessingPreviewResult<Row> => {
  const {
    request,
    identity,
    enabled = true,
    debounceMs = DEFAULT_DEBOUNCE_MS,
    initialPage = 1,
    initialPageSize = DEFAULT_PAGE_SIZE,
    fetcher,
  } = options;

  const ready = Boolean(enabled && request && identity);
  const requestIdentity =
    ready && request && identity ? hashKey([identity, request]) : 'preprocessing-preview-disabled';

  const [paginationState, setPaginationState] = useState({
    requestIdentity,
    page: initialPage,
    pageSize: initialPageSize,
  });
  const page =
    paginationState.requestIdentity === requestIdentity ? paginationState.page : initialPage;
  const pageSize =
    paginationState.requestIdentity === requestIdentity
      ? paginationState.pageSize
      : initialPageSize;
  const [debouncedRequestIdentity, setDebouncedRequestIdentity] = useState(
    'preprocessing-preview-disabled',
  );

  /**
   * Stores pagination with the active request identity to avoid stale pages.
   * Called by the public `setPage` action below.
   */
  const setPaginationDraft = (nextPage: number, nextPageSize: number) => {
    setPaginationState({
      requestIdentity,
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
      setDebouncedRequestIdentity(requestIdentity);
    }, debounceMs);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [debounceMs, requestIdentity, ready]);

  const queryKey =
    request && identity
      ? queryKeys.preprocessingPreview(
          identity.workspaceId,
          identity.operation,
          identity.nodeIds,
          request,
          page,
          pageSize,
        )
      : queryKeys.preprocessingPreviewDisabled;

  const previewQuery = useQuery({
    queryKey,
    enabled: ready && debouncedRequestIdentity === requestIdentity,
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
   * Refetches the current resource without creating a cache alias.
   * Returned to feature hooks as the manual `refresh` action.
   */
  const refresh = () => {
    void previewQuery.refetch();
  };

  const response = ready ? previewQuery.data : undefined;
  const queryError = previewQuery.error;

  return {
    data: response?.data ?? [],
    columns: response?.columns ?? [],
    pagination: response?.pagination ?? null,
    loading: ready && (debouncedRequestIdentity !== requestIdentity || previewQuery.isFetching),
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
