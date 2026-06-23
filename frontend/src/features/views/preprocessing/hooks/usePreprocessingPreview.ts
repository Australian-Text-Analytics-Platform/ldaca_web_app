import { useEffect, useRef, useState } from 'react';
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
  /** Optional unique signature. Falls back to JSON.stringify(request). */
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

interface PaginationState {
  signature: string;
  initialPage: number;
  initialPageSize: number;
  page: number;
  pageSize: number;
}

/**
 * Shared debounced preview loader for preprocessing tabs. Operation-specific
 * hooks supply the request and fetcher so pagination, cancellation, loading,
 * and error state behave consistently across tabs.
 * Used by: useJoinSubTab hook, useNodePreviewWithRawFallback hook, useConcatSubTab hook (rg call sites/imports) because those callers need a shared helper boundary for consistent feature state, formatting, or request payloads.
 * Flow: debounce request signatures, reset page state on request changes, call the provided
 * fetcher, and guard against stale responses with request ids.
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
    if (signature) return signature;
    try {
      return JSON.stringify(request);
    } catch {
      // eslint-disable-next-line react-hooks/purity -- Fallback for non-serializable requests; only reached when JSON.stringify throws
      return `preview-signature-${String(Date.now())}`;
    }
  })();

  const [paginationState, setPaginationState] = useState<PaginationState>(() => ({
    signature: derivedSignature,
    initialPage,
    initialPageSize,
    page: initialPage,
    pageSize: initialPageSize,
  }));
  const [data, setData] = useState<Row[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [pagination, setPagination] = useState<PreviewPagination | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const isPaginationCurrent =
    paginationState.signature === derivedSignature &&
    paginationState.initialPage === initialPage &&
    paginationState.initialPageSize === initialPageSize;
  const page = isPaginationCurrent ? paginationState.page : initialPage;
  const pageSize = isPaginationCurrent ? paginationState.pageSize : initialPageSize;

  /**
   * Stores pagination with the active request signature to avoid stale pages.
   * Called by: usePreprocessingPreview internal event, effect, or helper flow.
   */
  const setPaginationDraft = (nextPage: number, nextPageSize: number) => {
    setPaginationState({
      signature: derivedSignature,
      initialPage,
      initialPageSize,
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

  // Use refs for fetcher and request to avoid re-triggering the effect on
  // every render — callers typically pass inline functions/objects.
  const fetcherRef = useRef(fetcher);
  const requestRef = useRef(request);
  useEffect(() => {
    fetcherRef.current = fetcher;
    requestRef.current = request;
  });

  // Debounced preview fetcher shared by all preprocessing operations.
  useEffect(() => {
    const currentRequest = requestRef.current;
    if (!ready || !currentRequest) {
      setData([]);
      setColumns([]);
      setPagination(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    const timeoutId = window.setTimeout(() => {
      fetcherRef
        .current({ request: currentRequest, page, pageSize, signal: controller.signal })
        .then((response) => {
          if (cancelled) return;
          setData(Array.isArray(response.data) ? response.data : []);
          setColumns(Array.isArray(response.columns) ? response.columns : []);
          setPagination(response.pagination ?? null);
          if (response.pagination?.page && response.pagination.page !== page) {
            setPaginationState({
              signature: derivedSignature,
              initialPage,
              initialPageSize,
              page: response.pagination.page,
              pageSize,
            });
          }
        })
        .catch((err: unknown) => {
          if (cancelled || controller.signal.aborted) return;
          const message = err instanceof Error ? err.message : 'Failed to load preview data';
          setError(message);
          setData([]);
          setColumns([]);
          setPagination(null);
        })
        .finally(() => {
          if (!cancelled) {
            setLoading(false);
          }
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
    refreshKey,
    derivedSignature,
    initialPage,
    initialPageSize,
  ]);

  /**
   * Resets preview paging when consumers choose a different page size.
   * Called by: usePreprocessingPreview internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const handleSetPageSize = (size: number) => {
    setPaginationDraft(1, size);
  };

  /**
   * Forces a refetch without changing the current request or pagination.
   * Called by: usePreprocessingPreview internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const refresh = () => {
    setRefreshKey((current) => current + 1);
  };

  return {
    data,
    columns,
    pagination,
    loading,
    error,
    ready,
    page,
    pageSize,
    setPage,
    setPageSize: handleSetPageSize,
    refresh,
  };
};
