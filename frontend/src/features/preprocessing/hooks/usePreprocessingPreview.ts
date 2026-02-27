import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PreviewPagination, PreviewRow } from '../types';

export interface PreviewFetcherResult<Row = PreviewRow> {
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

  const [page, setPage] = useState(initialPage);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [data, setData] = useState<Row[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [pagination, setPagination] = useState<PreviewPagination | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const ready = Boolean(enabled && request);

  // Use refs for fetcher and request to avoid re-triggering the effect on
  // every render — callers typically pass inline functions/objects.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const requestRef = useRef(request);
  requestRef.current = request;

  const derivedSignature = useMemo(() => {
    if (!ready || !request) return 'disabled';
    if (signature) return signature;
    try {
      return JSON.stringify(request);
    } catch {
      return `preview-signature-${Date.now()}`;
    }
  }, [ready, request, signature]);

  // Reset pagination when the request payload changes materially.
  useEffect(() => {
    setPage(initialPage);
    setPageSize(initialPageSize);
  }, [derivedSignature, initialPage, initialPageSize]);

  // Debounced preview fetcher.
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
      fetcherRef.current({ request: currentRequest, page, pageSize, signal: controller.signal })
        .then((response) => {
          if (cancelled) return;
          setData(Array.isArray(response.data) ? response.data : []);
          setColumns(Array.isArray(response.columns) ? response.columns : []);
          setPagination(response.pagination ?? null);
          if (response.pagination?.page && response.pagination.page !== page) {
            setPage(response.pagination.page);
          }
        })
        .catch((err) => {
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
  }, [ready, page, pageSize, debounceMs, refreshKey, derivedSignature]);

  const handleSetPageSize = useCallback((size: number) => {
    setPageSize(size);
    setPage(1);
  }, []);

  const refresh = useCallback(() => {
    setRefreshKey((current) => current + 1);
  }, []);

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
