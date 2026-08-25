import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PaginationState } from '@tanstack/react-table';

import { queryWorkspaceSqlTable } from '@/api';
import { createNodeDataRequest, queryKeys } from '@/lib/queryKeys';
import {
  ANNOTATION_FILTERED_ROW_COUNT,
  buildAnnotationDifferenceQuery,
} from '../annotationDifferenceQuery';

export type AnnotationNodePageRow = Record<string, unknown>;

interface UseAnnotationNodePageArgs {
  workspaceId: string | null;
  nodeId: string;
  sourceSql: string;
  sourceColumns: string[];
  annotationColumn: string;
  differenceColumn: string | null;
  rowCount: number;
  pageSize: number;
  enabled?: boolean;
}

/**
 * Owns the canonical paginated source-node query used by Annotation tables.
 *
 * Used by the Manual and Review result tables. Flow: reset to the first page
 * when the source identity changes, key the request by the exact generated page
 * contract, and pass TanStack Query's abort signal into the generated client so
 * superseded page requests cannot complete as active work after navigation or a
 * source change.
 */
export function useAnnotationNodePage({
  workspaceId,
  nodeId,
  sourceSql,
  sourceColumns,
  annotationColumn,
  differenceColumn,
  rowCount,
  pageSize,
  enabled = true,
}: UseAnnotationNodePageArgs) {
  const differenceQuery = buildAnnotationDifferenceQuery({
    sourceSql,
    sourceColumns,
    annotationColumn,
    differenceColumn,
  });
  const scope = JSON.stringify([workspaceId, nodeId, pageSize, differenceQuery.pageSql]);
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
  const pageOwner = JSON.stringify([workspaceId, nodeId, differenceQuery.pageSql]);
  const query = useQuery<Awaited<ReturnType<typeof queryWorkspaceSqlTable>>>({
    queryKey: queryKeys.workspaceSql(
      workspaceId ?? '',
      [nodeId],
      differenceQuery.pageSql,
      request.page,
      request.page_size,
    ),
    enabled: Boolean(workspaceId) && enabled,
    meta: { annotationPageOwner: pageOwner },
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.meta?.annotationPageOwner === pageOwner ? previousData : undefined,
    queryFn: async ({ signal }) => {
      if (!workspaceId) throw new Error('Missing workspace ID');
      const data = await queryWorkspaceSqlTable({
        path: { workspace_id: workspaceId },
        body: {
          mode: 'query',
          node_ids: [nodeId],
          sql: differenceQuery.pageSql,
          page: request.page,
          page_size: request.page_size,
        },
        signal,
      });
      return data;
    },
  });
  const countSql = differenceQuery.countSql;
  const countQuery = useQuery<Awaited<ReturnType<typeof queryWorkspaceSqlTable>>>({
    queryKey: queryKeys.workspaceSql(
      workspaceId ?? '',
      [nodeId],
      countSql ?? 'annotation-filter-count-disabled',
      1,
      1,
    ),
    enabled: Boolean(workspaceId) && enabled && countSql !== null,
    queryFn: async ({ signal }) => {
      if (!workspaceId || !countSql) throw new Error('Missing Annotation filter count query');
      return await queryWorkspaceSqlTable({
        path: { workspace_id: workspaceId },
        body: {
          mode: 'query',
          node_ids: [nodeId],
          sql: countSql,
          page: 1,
          page_size: 1,
        },
        signal,
      });
    },
  });

  const filteredRowCountValue = countQuery.data?.rows[0]?.[ANNOTATION_FILTERED_ROW_COUNT];
  const filteredRowCount =
    typeof filteredRowCountValue === 'number'
      ? filteredRowCountValue
      : Number(filteredRowCountValue);
  const effectiveRowCount = countSql
    ? Number.isFinite(filteredRowCount)
      ? filteredRowCount
      : 0
    : rowCount;

  const refreshFilteredRows = async () => {
    if (!countSql) return;
    const [, countResult] = await Promise.all([query.refetch(), countQuery.refetch()]);
    const value = countResult.data?.rows[0]?.[ANNOTATION_FILTERED_ROW_COUNT];
    const nextRowCount = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(nextRowCount)) return;
    const lastPageIndex = Math.max(0, Math.ceil(nextRowCount / pagination.pageSize) - 1);
    if (pagination.pageIndex > lastPageIndex) {
      setPagination({ pageIndex: lastPageIndex, pageSize: pagination.pageSize });
    }
  };

  const rows = (query.data?.rows ?? []) as AnnotationNodePageRow[];
  return {
    pagination,
    setPagination,
    query,
    countQuery,
    rows,
    rowCount: effectiveRowCount,
    sourceRowIndexColumn: differenceQuery.sourceRowIndexColumn,
    refreshFilteredRows,
  };
}
