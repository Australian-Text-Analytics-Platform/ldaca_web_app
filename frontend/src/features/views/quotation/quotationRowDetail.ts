import type { RowDetailCustomization, RowDetailPayload } from '../common/components/RowDetailPanel';
import { QUOTATION_COLUMN_KEYS } from '../common/generatedColumns';
import { renderQuotationDetailText } from './components/quotationDetailText';
import type { QuotationResultRow } from './quotationResultsModel';

const GENERATED_QUOTATION_DETAIL_COLUMNS = [...Object.values(QUOTATION_COLUMN_KEYS), '__spans'];

/** Builds Quotation summary fields and highlighted document rendering. */
export const buildQuotationRowDetailCustomization = (
  row: QuotationResultRow,
): RowDetailCustomization => ({
  label: 'Quotation',
  summaryFields: [
    { label: 'Quote Type', value: row.cellText(QUOTATION_COLUMN_KEYS.quoteType) },
    { label: 'Speaker', value: row.cellText(QUOTATION_COLUMN_KEYS.speaker) },
    { label: 'Verb', value: row.cellText(QUOTATION_COLUMN_KEYS.verb) },
    { label: 'Quote', value: row.cellText(QUOTATION_COLUMN_KEYS.quote) },
  ],
  renderDocumentText: () => renderQuotationDetailText(row),
});

/** Converts one normalized quotation row into the shared detail payload. */
export const buildQuotationRowDetailPayload = (row: QuotationResultRow): RowDetailPayload => ({
  record: row.raw,
  textColumn: row.textColumn,
  fullText: row.text,
  excludeMetadataColumns: GENERATED_QUOTATION_DETAIL_COLUMNS,
});
