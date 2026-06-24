import type { RowDetailPanelProps } from '../../common/components/RowDetailPanel';
import { useRowDetailDialog } from '../../common/components/useRowDetailDialog';
import { QUOTATION_COLUMN_KEYS } from '../../common/generatedColumns';
import { renderQuotationDetailText } from '../components/quotationDetailText';
import { toCellText } from '../quotationCellText';

const GENERATED_QUOTATION_DETAIL_COLUMNS = [...Object.values(QUOTATION_COLUMN_KEYS), '__spans'];

interface UseQuotationRowDetailResult {
  detailPayload: RowDetailPanelProps['payload'];
  detailOpen: boolean;
  setDetailOpen: (open: boolean) => void;
  quotationCustomization: RowDetailPanelProps['customization'];
  handleRowClick: (row: Record<string, unknown>, textColumn: string) => void;
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
  record: Record<string, unknown>,
): RowDetailPanelProps['customization'] => ({
  label: 'Quotation',
  summaryFields: [
    {
      label: 'Quote Type',
      value: toCellText(record[QUOTATION_COLUMN_KEYS.quoteType]),
    },
    {
      label: 'Speaker',
      value: toCellText(record[QUOTATION_COLUMN_KEYS.speaker]),
    },
    {
      label: 'Verb',
      value: toCellText(record[QUOTATION_COLUMN_KEYS.verb]),
    },
    {
      label: 'Quote',
      value: toCellText(record[QUOTATION_COLUMN_KEYS.quote]),
    },
  ],
  /** Highlights speaker, quote, and verb spans in the source document text. */
  // Called by: RowDetailPanel document rendering because Quotation row details need generated span offsets applied to the original document text.
  renderDocumentText: (text, row) => renderQuotationDetailText(text, row),
});

/**
 * Owns Quotation's result-row detail click flow and customization state.
 * Used by: QuotationFeature so the feature shell can pass one row-click
 * handler to QuotationNodeBlock and render RowDetailPanel without carrying
 * generated-column detail rules inline.
 */
export function useQuotationRowDetail(): UseQuotationRowDetailResult {
  const { detailPayload, detailOpen, setDetailOpen, openDetail } = useRowDetailDialog();

  const handleRowClick = (row: Record<string, unknown>, textColumn: string) => {
    const record = { ...row };
    const rawFullText = record[textColumn];
    const fullText = rawFullText == null ? undefined : toCellText(rawFullText);

    openDetail({
      record,
      textColumn,
      fullText,
      excludeMetadataColumns: GENERATED_QUOTATION_DETAIL_COLUMNS,
    });
  };

  return {
    detailPayload,
    detailOpen,
    setDetailOpen,
    quotationCustomization: detailPayload
      ? buildQuotationCustomization(detailPayload.record)
      : undefined,
    handleRowClick,
  };
}
