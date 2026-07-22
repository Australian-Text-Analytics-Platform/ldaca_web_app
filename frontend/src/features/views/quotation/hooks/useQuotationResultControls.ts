import { useCallback, useReducer, type Dispatch, type SetStateAction } from 'react';

import type { QuotationAnalysisResponse, QuotationMetadata } from '@/api';
import type { NodePaginationState } from '../../common/tasks/types';
import { normalizeQuotationRow, type QuotationResultRow } from '../quotationResultsModel';

export interface QuotationResultState {
  groupedRows: QuotationGroupedRow[];
  rows: QuotationResultRow[];
  columns: string[];
  metadata: QuotationMetadata;
  pagination: {
    page: number;
    page_size: number;
    total_source_rows: number;
    total_source_pages: number;
    result_count: number;
    has_next: boolean;
    has_prev: boolean;
  };
  sorting: {
    sort_by?: string | null;
    descending: boolean;
  };
  column: string;
}

type QuotationHitRow = Record<string, unknown>;
type QuotationGroupedRow = QuotationHitRow[];
type BooleanMapUpdater = SetStateAction<Record<string, boolean>>;

const buildQuotationResultState = (
  result: QuotationAnalysisResponse,
  column: string,
): QuotationResultState => {
  const groupedRows = result.data;
  return {
    groupedRows,
    rows: groupedRows.flatMap((group) => group).map((row) => normalizeQuotationRow(row, column)),
    columns: result.metadata.all_columns.slice(),
    metadata: result.metadata,
    pagination: result.pagination,
    sorting: result.sorting,
    column,
  };
};

interface UseQuotationResultControlsOptions {
  result: QuotationAnalysisResponse | null;
  nodeId: string;
  column: string;
}

/** Projects immutable Query result data and owns only detach progress. */
export function useQuotationResultControls({
  result,
  nodeId,
  column,
}: UseQuotationResultControlsOptions) {
  const [nodeDetaching, dispatch] = useReducer(
    (state: Record<string, boolean>, updater: BooleanMapUpdater) =>
      typeof updater === 'function' ? updater(state) : updater,
    {},
  );

  const setNodeDetaching: Dispatch<SetStateAction<Record<string, boolean>>> = useCallback(
    (updater) => {
      dispatch(updater);
    },
    [],
  );

  const normalized = result && nodeId && column ? buildQuotationResultState(result, column) : null;
  const resultsByNode = normalized ? { [nodeId]: normalized } : {};
  const nodeState: Record<string, NodePaginationState> = normalized
    ? {
        [nodeId]: {
          currentPage: normalized.pagination.page,
          pageSize: normalized.pagination.page_size,
          sortBy: normalized.sorting.sort_by ?? undefined,
          descending: normalized.sorting.descending,
        },
      }
    : {};

  return { nodeState, nodeDetaching, setNodeDetaching, resultsByNode };
}
