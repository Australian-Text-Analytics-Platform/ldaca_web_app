import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PaginationState } from '@tanstack/react-table';

import { getNodeDataByWorkspaceId } from '@/api';
import { createNodeDataRequest, queryKeys } from '@/lib/queryKeys';

export type AnnotationNodePageRow = Record<string, unknown>;

interface UseAnnotationNodePageArgs {
  workspaceId: string | null;
  nodeId: string;
  pageSize: number;
  enabled?: boolean;
}

/**
 * Owns the canonical paginated source-node query used by Annotation tables.
 *
 * Used by: `AnnotationResultsPanel` for manual editing and
 * `useAnnotationAiPreviewSession` for page-aligned AI predictions. Flow: reset
 * to the first page when the source identity changes, key the request by the
 * exact generated page contract, and pass TanStack Query's abort signal into
 * the generated client so superseded page requests cannot complete as active
 * work after navigation or a source change.
 */
export function useAnnotationNodePage({
  workspaceId,
  nodeId,
  pageSize,
  enabled = true,
}: UseAnnotationNodePageArgs) {
  const scope = JSON.stringify([workspaceId, nodeId, pageSize]);
  const [paginationState, setPaginationState] = useState<{
    scope: string;
    value: PaginationState;
  }>(() => ({ scope, value: { pageIndex: 0, pageSize } }));
  const pagination =
    paginationState.scope === scope ? paginationState.value : { pageIndex: 0, pageSize };
  const setPagination = (value: PaginationState) => {
    setPaginationState({ scope, value });
  };

  const request = createNodeDataRequest({
    page: pagination.pageIndex + 1,
    page_size: pagination.pageSize,
  });
  const query = useQuery({
    queryKey: queryKeys.nodeData(workspaceId ?? '', nodeId, request),
    enabled: Boolean(workspaceId) && enabled,
    queryFn: async ({ signal }) => {
      if (!workspaceId) throw new Error('Missing workspace ID');
      const { data } = await getNodeDataByWorkspaceId({
        path: { workspace_id: workspaceId, node_id: nodeId },
        query: request,
        signal,
        throwOnError: true,
      });
      return data;
    },
  });

  const rows = (query.data?.data ?? []) as AnnotationNodePageRow[];
  return {
    pagination,
    setPagination,
    query,
    rows,
    revision: query.data?.revision ?? '',
    rowCount: query.data?.pagination.total_rows ?? rows.length,
  };
}
