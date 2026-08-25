import { Vector } from 'apache-arrow';

import type { QuotationMetadata, RunAllSourceTableResource } from '@/api';
import type { ArrowTablePage } from '@/lib/arrow/arrowTable';
import type { NodeDataRequest } from '@/lib/queryKeys';

import { normalizeQuotationRow, type QuotationResultRow } from './quotationResultsModel';

export type QuotationReviewRowUnit = 'documents' | 'matches';

export interface QuotationResultState {
  groupedRows: Record<string, unknown>[][];
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

export type QuotationPageSource =
  | {
      kind: 'preview';
      nodeId: string;
      documentColumn: string;
    }
  | {
      kind: 'run_all';
      resource: RunAllSourceTableResource;
      rowUnit: QuotationReviewRowUnit;
    };

const quotationFieldMap: Record<string, string> = {
  speaker: 'QUOTE_speaker',
  speaker_start_idx: 'QUOTE_speaker_start_idx',
  speaker_end_idx: 'QUOTE_speaker_end_idx',
  quote: 'QUOTE_quote',
  quote_start_idx: 'QUOTE_quote_start_idx',
  quote_end_idx: 'QUOTE_quote_end_idx',
  verb: 'QUOTE_verb',
  verb_start_idx: 'QUOTE_verb_start_idx',
  verb_end_idx: 'QUOTE_verb_end_idx',
  quote_type: 'QUOTE_quote_type',
  quote_token_count: 'QUOTE_quote_token_count',
  is_floating_quote: 'QUOTE_is_floating_quote',
  quote_row_idx: 'QUOTE_quote_row_idx',
};

const materializeNativeArrowValue = (value: unknown): unknown => {
  if (Vector.isVector(value)) {
    return Array.from(value, (child) => materializeNativeArrowValue(child));
  }
  if (Array.isArray(value)) return value.map((child) => materializeNativeArrowValue(child));
  if (value && typeof value === 'object' && 'toJSON' in value) {
    const toJSON = (value as { toJSON?: unknown }).toJSON;
    if (typeof toJSON === 'function') {
      return materializeNativeArrowValue((toJSON as () => unknown).call(value));
    }
  }
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, materializeNativeArrowValue(child)]),
    );
  }
  return value;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const nativeRows = (page: ArrowTablePage): Record<string, unknown>[] =>
  page.table.toArray().flatMap((row) => {
    const value = materializeNativeArrowValue(row);
    return isRecord(value) ? [value] : [];
  });

const projectQuotationHit = (value: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(value).map(([column, cell]) => [quotationFieldMap[column] ?? column, cell]),
  );

const previewQuotationColumns = (): string[] => Object.values(quotationFieldMap);

/** Projects either quotation transport into the single presentation-ready state. */
export function projectQuotationArrowPage(
  source: QuotationPageSource,
  page: ArrowTablePage,
  request: NodeDataRequest,
): QuotationResultState {
  const documentColumn =
    source.kind === 'preview' ? source.documentColumn : source.resource.document_column;
  const rowUnit = source.kind === 'preview' ? 'documents' : source.rowUnit;
  const internalColumns =
    source.kind === 'preview'
      ? page.columns.filter((column) => column.startsWith('__wordflow_'))
      : source.resource.internal_columns;
  const rows = nativeRows(page);
  const groupedRows = rows.flatMap((rawRow) => {
    const base = Object.fromEntries(
      Object.entries(rawRow).filter(
        ([column]) => !internalColumns.includes(column) && column !== 'quotation',
      ),
    );
    const hits =
      rowUnit === 'documents' && Array.isArray(rawRow.quotation) ? rawRow.quotation : [rawRow];
    const group = hits.flatMap((hit) =>
      hit && typeof hit === 'object' && !Array.isArray(hit)
        ? [{ ...base, ...projectQuotationHit(hit as Record<string, unknown>) }]
        : [],
    );
    return group.length > 0 ? [group] : [];
  });
  const metadataColumns =
    source.kind === 'preview'
      ? page.columns.filter(
          (column) =>
            column !== documentColumn &&
            column !== 'quotation' &&
            !internalColumns.includes(column),
        )
      : source.resource.metadata_columns.filter((column) => !internalColumns.includes(column));
  const quotationColumns =
    source.kind === 'preview'
      ? previewQuotationColumns()
      : source.resource.analysis_columns.filter((column) => !internalColumns.includes(column));
  const columns = Array.from(new Set([documentColumn, ...metadataColumns, ...quotationColumns]));
  const declaredTotal =
    source.kind === 'run_all'
      ? rowUnit === 'documents'
        ? source.resource.document_count
        : source.resource.match_count
      : null;
  const totalRows = page.totalRows ?? declaredTotal ?? 0;
  const metadata: QuotationMetadata = {
    all_columns: columns,
    metadata_columns: metadataColumns,
    concordance_columns: [],
    quotation_columns: quotationColumns,
  };

  return {
    groupedRows,
    rows: groupedRows
      .flatMap((group) => group)
      .map((row) => normalizeQuotationRow(row, documentColumn)),
    columns,
    metadata,
    pagination: {
      page: request.page,
      page_size: request.page_size,
      total_source_rows: totalRows,
      total_source_pages: totalRows === 0 ? 0 : Math.ceil(totalRows / request.page_size),
      result_count: groupedRows.length,
      has_next: page.hasNext,
      has_prev: request.page > 1,
    },
    sorting: {
      sort_by: request.sort_by,
      descending: request.descending,
    },
    column: documentColumn,
  };
}
