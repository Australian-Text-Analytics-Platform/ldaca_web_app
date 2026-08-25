import type { ReactNode } from 'react';

import {
  buildQuotationSegments,
  buildQuotationUnderlineStyle,
  getQuotationHighlightColor,
  type QuotationResultRow,
} from '../quotationResultsModel';

/**
 * Renders full quotation text from the canonical row model. Unlike the table
 * adapter it does not clip; both adapters share the exact same segments,
 * palette, and overlap ordering.
 *
 * Used by: `useQuotationRowDetail` for the shared row-detail document slot.
 */
export const renderQuotationDetailText = (row: QuotationResultRow): ReactNode => {
  if (row.text.length === 0 || row.spans.length === 0) return row.text;
  const segments = buildQuotationSegments(row.text, row.spans);

  return (
    <span>
      {segments.map((segment) => (
        <span key={`${String(segment.start)}:${String(segment.end)}`}>
          {segment.types.map((type) => (
            <span
              key={type}
              className="mr-1 rounded-sm border px-1 py-0.5 align-baseline text-badge font-semibold"
              style={{
                color: '#0f172a',
                borderColor: getQuotationHighlightColor(type),
                backgroundColor: '#f1f5f9',
              }}
            >
              {type.toUpperCase()}
            </span>
          ))}
          <span style={buildQuotationUnderlineStyle(segment.types)}>{segment.text}</span>
        </span>
      ))}
      {row.quoteType ? (
        <span className="ml-1 rounded-sm border border-surface-border bg-panel px-1 py-0.5 align-baseline text-badge text-description">
          {row.quoteType}
        </span>
      ) : null}
    </span>
  );
};
