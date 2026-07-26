import { useQuery } from '@tanstack/react-query';
import type { PaginationState } from '@tanstack/react-table';
import { useState } from 'react';

import {
  queryWorkspaceSqlTable,
  sqlTable,
  type AnnotationPreviewLabel,
  type AnnotationResult,
} from '@/api';
import { queryAnnotationPreviewWithProviderCredential } from '@/features/provider-credentials/providerCredentialRequests';
import { queryKeys } from '@/lib/queryKeys';

const AI_PREVIEW_PAGE_SIZE = 10;
export type AnnotationPreviewRow = Record<string, unknown>;

interface UseAnnotationAiPreviewArgs {
  workspaceId: string | null;
  analysisId: string | null;
  providerConfigurationId: string | null;
  nodeId: string;
  textColumn: string;
  annotationColumn: string;
  enabled: boolean;
}

/**
 * Projects fresh pages from one durable Annotation Preview Analysis.
 *
 * The root Analysis owns the immutable source and settings. Every page
 * navigation posts a new Result query and no prediction page is retained as
 * durable Analysis output.
 */
export function useAnnotationAiPreview({
  workspaceId,
  analysisId,
  providerConfigurationId,
  nodeId,
  textColumn,
  annotationColumn,
  enabled,
}: UseAnnotationAiPreviewArgs) {
  const scope = JSON.stringify([workspaceId, analysisId, AI_PREVIEW_PAGE_SIZE]);
  const [paginationState, setPaginationState] = useState<{
    scope: string;
    value: PaginationState;
  }>(() => ({
    scope,
    value: { pageIndex: 0, pageSize: AI_PREVIEW_PAGE_SIZE },
  }));
  const pagination =
    paginationState.scope === scope
      ? paginationState.value
      : { pageIndex: 0, pageSize: AI_PREVIEW_PAGE_SIZE };
  const setPagination = (value: PaginationState) => {
    setPaginationState({ scope, value });
  };
  const projection = {
    kind: 'annotation',
    page: pagination.pageIndex + 1,
    page_size: pagination.pageSize,
    provider_configuration_id: providerConfigurationId,
  } as const;
  const query = useQuery({
    queryKey:
      workspaceId && analysisId
        ? queryKeys.analysisResult(workspaceId, analysisId, projection)
        : queryKeys.inactiveAnalysisResult(projection),
    enabled: enabled && Boolean(workspaceId && analysisId && providerConfigurationId),
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async ({ signal }): Promise<AnnotationResult> => {
      if (!workspaceId || !analysisId || !projection.provider_configuration_id) {
        throw new Error('Annotation Preview is not available');
      }
      const { data } = await queryAnnotationPreviewWithProviderCredential({
        workspaceId,
        analysisId,
        providerConfigurationId: projection.provider_configuration_id,
        page: projection.page,
        pageSize: projection.page_size,
        signal,
      });
      if (data.kind !== 'annotation' || !data.rows || !data.labels) {
        throw new Error('Annotation Preview returned an invalid page');
      }
      return data;
    },
  });
  const sourcePageSql = `SELECT * FROM ${sqlTable(nodeId)}`;
  const sourcePageQuery = useQuery({
    queryKey: queryKeys.workspaceSql(
      workspaceId ?? '',
      [nodeId],
      sourcePageSql,
      projection.page,
      projection.page_size,
    ),
    enabled: enabled && Boolean(workspaceId && nodeId),
    queryFn: async ({ signal }) => {
      if (!workspaceId) {
        throw new Error('Annotation source page is not available');
      }
      return await queryWorkspaceSqlTable({
        path: { workspace_id: workspaceId },
        body: {
          mode: 'query',
          node_ids: [nodeId],
          sql: sourcePageSql,
          page: projection.page,
          page_size: projection.page_size,
        },
        signal,
      });
    },
  });
  const previewRows = (query.data?.rows ?? []) as AnnotationPreviewRow[];
  const sourceRows = (sourcePageQuery.data?.rows ?? []) as AnnotationPreviewRow[];
  const rows = previewRows.map((row, index) => ({ ...sourceRows[index], ...row }));
  const byIndex = new Map<number, string | null>();
  (query.data?.labels ?? []).forEach((label: AnnotationPreviewLabel) => {
    byIndex.set(label.row_index, label.label);
  });
  const start = pagination.pageIndex * pagination.pageSize;

  return {
    columns: { text: textColumn, annotation: annotationColumn },
    sourceColumns: sourcePageQuery.data?.columns ?? [],
    page: {
      rows,
      // Keep the selected page represented in the footer while its fresh
      // projection is pending without retaining rows from the prior page.
      rowCount:
        query.data?.total_rows ??
        (query.isLoading ? (pagination.pageIndex + 1) * pagination.pageSize : 0),
      pagination,
      setPagination,
      query,
    },
    predictions: {
      labels: rows.map((_, index) => byIndex.get(start + index) ?? null),
      query,
    },
    comparison: {
      query: sourcePageQuery,
    },
  };
}

export type AnnotationAiPreview = ReturnType<typeof useAnnotationAiPreview>;
