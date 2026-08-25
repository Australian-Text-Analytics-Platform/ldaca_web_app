import { useQuery } from '@tanstack/react-query';

import type { RunAllSourceTableResource } from '@/api';
import { queryQuotationPreviewArrowTable } from '@/api/tableApi';
import { fetchArrowTablePage } from '@/lib/arrow/arrowTable';
import { queryKeys, type NodeDataRequest } from '@/lib/queryKeys';

import {
  projectQuotationArrowPage,
  type QuotationResultState,
  type QuotationReviewRowUnit,
} from '../quotationArrowPage';

export type QuotationPageTarget =
  | {
      kind: 'preview';
      workspaceId: string;
      analysisId: string;
      nodeId: string;
      documentColumn: string;
    }
  | {
      kind: 'run_all';
      workspaceId: string;
      analysisId: string;
      source: RunAllSourceTableResource;
      rowUnit: QuotationReviewRowUnit;
    };

/** Fetches and projects Preview and Run All quotation pages through one Arrow-native path. */
export function useQuotationPage(target: QuotationPageTarget | null, request: NodeDataRequest) {
  const tableId = target?.kind === 'preview' ? 'quotation-preview' : target?.source.table.table_id;
  const rowUnit = target?.kind === 'run_all' ? target.rowUnit : 'documents';
  const query = useQuery({
    queryKey:
      target && tableId
        ? queryKeys.analysisTableProjectionPage(
            target.workspaceId,
            target.analysisId,
            tableId,
            rowUnit,
            request,
          )
        : queryKeys.inactiveAnalysisResult({ ...request }),
    enabled: target !== null,
    placeholderData: (previousData, previousQuery) =>
      target && previousQuery?.queryKey.some((part) => part === target.analysisId)
        ? previousData
        : undefined,
    queryFn: async (): Promise<QuotationResultState> => {
      if (!target) throw new Error('Quotation page is unavailable');
      const page =
        target.kind === 'preview'
          ? await queryQuotationPreviewArrowTable({
              path: {
                workspace_id: target.workspaceId,
                analysis_id: target.analysisId,
              },
              body: request,
            })
          : await fetchArrowTablePage(target.source.table[target.rowUnit].rows_url, {
              page: request.page,
              pageSize: request.page_size,
              sortBy: request.sort_by,
              descending: request.descending,
            });
      return projectQuotationArrowPage(
        target.kind === 'preview'
          ? {
              kind: 'preview',
              nodeId: target.nodeId,
              documentColumn: target.documentColumn,
            }
          : { kind: 'run_all', resource: target.source, rowUnit: target.rowUnit },
        page,
        request,
      );
    },
  });

  return query;
}
