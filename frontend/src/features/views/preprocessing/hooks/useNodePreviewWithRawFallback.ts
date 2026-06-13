import { getNodeData } from '@/api/generated/sdk.gen';
import { useAuth } from '@/features/auth/hooks/useAuth';
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

/**
 * Normalizes generated/raw preview responses before table components consume them.
 * Used by: local callers in preprocessing/useNodePreviewWithRawFallback module because nearby helpers need the same normalization, formatting, or adapter rule without duplicating it.
 */
const normaliseResponse = (response: RawishResponse | null | undefined) => ({
  data: Array.isArray(response?.data) ? (response.data as PreviewRow[]) : [],
  columns: Array.isArray(response?.columns) ? (response.columns as string[]) : [],
  pagination: (response?.pagination as PreviewPagination | undefined) ?? null,
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
   * `getNodeData` so the user always sees source rows even before they've
   * configured a valid operation.
   */
  operationPayload: P | null;
  /** Operation-specific preview endpoint (e.g. generated `filterPreview`). */
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
 * and a fetcher that branches on `payload === null` to call `getNodeData`.
 * Used by: useFilterSubTabSections hook, useAggregateSubTab hook, useSliceSubTab hook (rg call sites/imports) because those callers need a shared helper boundary for consistent feature state, formatting, or request payloads.
 * Flow: call preprocessing preview first, fall back to raw node preview when no request is
 * ready, and expose one preview state shape to callers.
 */
export const useNodePreviewWithRawFallback = <P>(
  opts: UseNodePreviewWithRawFallbackOptions<P>,
): UsePreprocessingPreviewResult => {
  const {
    nodeId,
    operationPayload,
    operationFetch,
    signaturePrefix,
    enabled = true,
    debounceMs,
  } = opts;
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
    // Routes complete operation payloads to the operation preview endpoint and
    // incomplete ones to raw node data so users always have rows to inspect.
    // Called by: usePreprocessingPreview option object inside useNodePreviewWithRawFallback because consumers need this callback at the object boundary instead of recreating it inline.
    fetcher: async ({ request: req, page, pageSize }) => {
      if (req.payload) {
        return normaliseResponse(await operationFetch(req.nodeId, req.payload, page, pageSize));
      }
      const { data } = await getNodeData({
        headers: getAuthHeaders(),
        path: { node_id: req.nodeId },
        query: { page, page_size: pageSize },
        throwOnError: true,
      });
      return normaliseResponse(data);
    },
  });
};
