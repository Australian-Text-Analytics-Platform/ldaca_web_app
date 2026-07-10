import { useState } from 'react';

import type { RowDetailPanelProps } from '../../common/components/RowDetailPanel';
import { useRowDetailDialog } from '../../common/components/useRowDetailDialog';
import { QUOTATION_COLUMN_KEYS } from '../../common/generatedColumns';
import { renderQuotationDetailText } from '../components/quotationDetailText';
import type { QuotationResultRow } from '../quotationResultsModel';

const GENERATED_QUOTATION_DETAIL_COLUMNS = [...Object.values(QUOTATION_COLUMN_KEYS), '__spans'];

interface UseQuotationRowDetailResult {
  detailPayload: RowDetailPanelProps['payload'];
  detailOpen: boolean;
  setDetailOpen: (open: boolean) => void;
  quotationCustomization: RowDetailPanelProps['customization'];
  handleRowClick: (row: QuotationResultRow) => void;
}

/**
 * Builds the Quotation-specific summary and highlighted document renderer for
 * the shared row-detail dialog.
 * Used by: useQuotationRowDetail after a result row click because
 * RowDetailPanel only knows generic row metadata, while Quotation needs
 * generated quote/speaker/verb fields summarized and hidden from the metadata
 * table.
 */
const buildQuotationCustomization = (
  row: QuotationResultRow,
): RowDetailPanelProps['customization'] => ({
  label: 'Quotation',
  summaryFields: [
    {
      label: 'Quote Type',
      value: row.cellText(QUOTATION_COLUMN_KEYS.quoteType),
    },
    {
      label: 'Speaker',
      value: row.cellText(QUOTATION_COLUMN_KEYS.speaker),
    },
    {
      label: 'Verb',
      value: row.cellText(QUOTATION_COLUMN_KEYS.verb),
    },
    {
      label: 'Quote',
      value: row.cellText(QUOTATION_COLUMN_KEYS.quote),
    },
  ],
  /** Highlights speaker, quote, and verb spans in the source document text. */
  // Called by: RowDetailPanel document rendering because Quotation row details need generated span offsets applied to the original document text.
  renderDocumentText: () => renderQuotationDetailText(row),
});

/**
 * Owns Quotation's result-row detail click flow and customization state.
 * Used by: QuotationFeature so the feature shell can pass one row-click
 * handler to QuotationNodeBlock and render RowDetailPanel without carrying
 * generated-column detail rules inline.
 */
export function useQuotationRowDetail(): UseQuotationRowDetailResult {
  const { detailPayload, detailOpen, setDetailOpen, openDetail } = useRowDetailDialog();
  const [selectedRow, setSelectedRow] = useState<QuotationResultRow | null>(null);

  const handleRowClick = (row: QuotationResultRow) => {
    setSelectedRow(row);
    openDetail({
      record: row.raw,
      textColumn: row.textColumn,
      fullText: row.text,
      excludeMetadataColumns: GENERATED_QUOTATION_DETAIL_COLUMNS,
    });
  };

  return {
    detailPayload,
    detailOpen,
    setDetailOpen,
    quotationCustomization:
      detailPayload && selectedRow ? buildQuotationCustomization(selectedRow) : undefined,
    handleRowClick,
  };
}
