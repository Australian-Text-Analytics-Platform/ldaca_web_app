import { nodesApi } from '@/lib/backend/nodes';
import { useAuth } from '@/hooks/useAuth';
import type { PreviewPagination, PreviewRow } from '../types';
import {
  usePreprocessingPreview,
  type UsePreprocessingPreviewResult,
} from './usePreprocessingPreview';

interface RawishResponse {
  data?: unknown;
  columns?: unknown;
  pagination?: unknown;
}

const normaliseResponse = (response: RawishResponse | null | undefined) => ({
  data: Array.isArray(response?.data) ? (response.data as PreviewRow[]) : [],
  columns: Array.isArray(response?.columns) ? (response.columns as string[]) : [],
  pagination: (response?.pagination as PreviewPagination) ?? null,
});

interface PreviewRequest<P> {
  nodeId: string;
  payload: P | null;
}

export interface UseNodePreviewWithRawFallbackOptions<P> {
  /** Currently-active node id, or null if no selection. */
  nodeId: string | null;
  /**
   * The operation-specific payload. When `null`, the hook falls back to
   * `nodesApi.data` so the user always sees source rows even before they've
   * configured a valid operation.
   */
  operationPayload: P | null;
  /** Operation-specific preview endpoint (e.g. `nodesApi.filterPreview`). */
  operationFetch: (
    nodeId: string,
    payload: P,
    page: number,
    pageSize: number,
  ) => Promise<RawishResponse>;
  /**
   * String prefix used when building the cache signature (e.g. `'replace'`).
   * Disambiguates between sub-tabs that might happen to JSON-stringify to
   * the same shape.
   */
  signaturePrefix: string;
  /** When false (e.g. no node selected), the hook stays idle. */
  enabled?: boolean;
  /** Optional override for the debounce delay (default 600ms). */
  debounceMs?: number;
}

/**
 * Standardises the "operation preview, with raw-data fallback when the
 * payload is incomplete" pattern that every preprocessing sub-tab implements.
 *
 * Replaces ~5 hand-rolled copies of: request shape with `payload: null`,
 * a manual signature builder with `disabled`/`::raw`/`::<json>` branches,
 * and a fetcher that branches on `payload === null` to call `nodesApi.data`.
 */
export const useNodePreviewWithRawFallback = <P>(
  opts: UseNodePreviewWithRawFallbackOptions<P>,
): UsePreprocessingPreviewResult<PreviewRow> => {
  const { nodeId, operationPayload, operationFetch, signaturePrefix, enabled = true, debounceMs } = opts;
  const { getAuthHeaders } = useAuth();

  const request: PreviewRequest<P> | null =
    enabled && nodeId ? { nodeId, payload: operationPayload } : null;

  let signature = `${signaturePrefix}-preview-disabled`;
  if (request?.payload) {
    try {
      signature = `${request.nodeId}::${JSON.stringify(request.payload)}`;
    } catch {
      signature = `${request.nodeId}::unserialisable`;
    }
  } else if (request) {
    signature = `${request.nodeId}::raw`;
  }

  return usePreprocessingPreview<PreviewRequest<P>>({
    request,
    signature,
    debounceMs,
    fetcher: async ({ request: req, page, pageSize }) => {
      if (req.payload) {
        return normaliseResponse(await operationFetch(req.nodeId, req.payload, page, pageSize));
      }
      return normaliseResponse(
        await nodesApi.data(req.nodeId, { page, pageSize }, getAuthHeaders()),
      );
    },
  });
};
