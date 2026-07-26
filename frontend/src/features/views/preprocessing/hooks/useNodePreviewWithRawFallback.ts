import { queryWorkspaceSqlTable, sqlTable } from '@/api';
import type { PreviewPagination, PreviewRow } from '../types';
import {
  usePreprocessingPreview,
  type UsePreprocessingPreviewResult,
} from './usePreprocessingPreview';

interface OperationPreviewResult {
  data: PreviewRow[];
  columns: string[];
  pagination: PreviewPagination;
}

interface PreviewRequest<P> {
  workspaceId: string;
  nodeId: string;
  payload: P | null;
}

export type OperationPreviewFetcher<P> = (params: {
  workspaceId: string;
  nodeId: string;
  payload: P;
  page: number;
  pageSize: number;
  signal: AbortSignal;
}) => Promise<OperationPreviewResult>;

export interface UseNodePreviewWithRawFallbackOptions<P> {
  /** Currently-active workspace id, or null if no workspace is selected. */
  workspaceId: string | null;
  /** Currently-active node id, or null if no selection. */
  nodeId: string | null;
  /**
   * The operation-specific payload. When `null`, the hook falls back to
   * node-data endpoint so the user always sees source rows even before they've
   * configured a valid operation.
   */
  operationPayload: P | null;
  /** Operation-specific preview endpoint (e.g. generated `filterPreview`). */
  operationFetch: OperationPreviewFetcher<P>;
  /** Operation name stored in the structured preview identity. */
  operation: string;
  /** When false (e.g. no node selected), the hook stays idle. */
  enabled?: boolean;
  /** Optional override for the debounce delay (default 600ms). */
  debounceMs?: number;
}

/**
 * Standardises the "operation preview, with raw-data fallback when the
 * payload is incomplete" pattern that every preprocessing sub-tab implements.
 *
 * Used by Filter, Aggregate, Expression, Replace, and Slice hooks that can
 * preview either an operation or the raw selected node.
 * Flow: call preprocessing preview first, fall back to raw node preview when no request is
 * ready, and expose one preview state shape to callers.
 */
export const useNodePreviewWithRawFallback = <P>(
  opts: UseNodePreviewWithRawFallbackOptions<P>,
): UsePreprocessingPreviewResult => {
  const {
    workspaceId,
    nodeId,
    operationPayload,
    operationFetch,
    operation,
    enabled = true,
    debounceMs,
  } = opts;

  const request: PreviewRequest<P> | null =
    enabled && workspaceId && nodeId ? { workspaceId, nodeId, payload: operationPayload } : null;

  return usePreprocessingPreview<PreviewRequest<P>>({
    request,
    identity: request
      ? {
          workspaceId: request.workspaceId,
          operation,
          nodeIds: [request.nodeId],
        }
      : null,
    debounceMs,
    // Routes complete operation payloads to the operation preview endpoint and
    // incomplete ones to raw node data so users always have rows to inspect.
    // Invoked by usePreprocessingPreview after debounce/cancellation setup.
    fetcher: async ({ request: req, page, pageSize, signal }) => {
      if (req.payload) {
        return operationFetch({
          workspaceId: req.workspaceId,
          nodeId: req.nodeId,
          payload: req.payload,
          page,
          pageSize,
          signal,
        });
      }
      const data = await queryWorkspaceSqlTable({
        path: { workspace_id: req.workspaceId },
        body: {
          mode: 'query',
          node_ids: [req.nodeId],
          sql: `SELECT * FROM ${sqlTable(req.nodeId)}`,
          page,
          page_size: pageSize,
        },
        signal,
      });
      return {
        data: data.rows,
        columns: data.columns,
        pagination: { page, page_size: pageSize, has_next: data.hasNext },
      };
    },
  });
};
