import {
  buildQuotationSegments,
  buildQuotationUnderlineStyle,
  getQuotationHighlightColor,
  quotationColorWithAlpha,
  type QuotationHighlightType,
  type QuotationResultRow,
} from '../quotationResultsModel';
import { clipTextAroundSpans } from '../quotationTextClip';

export interface QuotationHoverState {
  key: string;
  segmentStart: number;
  type: QuotationHighlightType;
}

interface QuotationHighlightedCellProps {
  row: QuotationResultRow;
  cellKey: string;
  contextLength: number;
  hoverState: QuotationHoverState | null;
  onHoverChange: (state: QuotationHoverState | null) => void;
}

/**
 * Renders one already-normalized quotation document cell. Row/span parsing is
 * deliberately absent: `normalizeQuotationRow` is the sole payload boundary,
 * while this adapter only clips and paints canonical segments.
 *
 * Rendered by: `QuotationNodeBlock` for its document pseudo-column.
 */
export function QuotationHighlightedCell({
  row,
  cellKey,
  contextLength,
  hoverState,
  onHoverChange,
}: QuotationHighlightedCellProps) {
  if (row.text.length === 0 || row.spans.length === 0) return <>{row.text}</>;

  const clipped = clipTextAroundSpans(row.text, row.spans, contextLength);
  const segments = buildQuotationSegments(clipped.text, clipped.spans);

  return (
    <span>
      {clipped.prefixEllipsis ? <span className="mr-1 text-description">...</span> : null}
      {segments.map((segment) => {
        const primaryType = segment.primaryType;
        if (segment.types.length === 0 || primaryType === null) {
          return (
            <span key={`${String(segment.start)}:${String(segment.end)}`}>{segment.text}</span>
          );
        }

        const isHovered = hoverState?.key === cellKey && hoverState.segmentStart === segment.start;
        const hoveredType =
          isHovered && segment.types.includes(hoverState.type) ? hoverState.type : primaryType;

        return (
          <span key={`${String(segment.start)}:${String(segment.end)}`}>
            {segment.types.map((type) => (
              <span
                key={type}
                className="mr-1 cursor-pointer rounded-sm border px-1 py-0.5 align-baseline text-badge font-semibold"
                style={{
                  color: '#0f172a',
                  borderColor: getQuotationHighlightColor(type),
                  backgroundColor:
                    isHovered && hoverState.type === type
                      ? quotationColorWithAlpha(type, 0.28)
                      : '#f1f5f9',
                }}
                onMouseEnter={() => {
                  onHoverChange({ key: cellKey, segmentStart: segment.start, type });
                }}
                onMouseLeave={() => {
                  onHoverChange(null);
                }}
              >
                {type.toUpperCase()}
              </span>
            ))}
            <span
              style={{
                ...buildQuotationUnderlineStyle(segment.types),
                ...(isHovered
                  ? {
                      backgroundColor: quotationColorWithAlpha(hoveredType, 0.22),
                      borderRadius: 3,
                      paddingLeft: 1,
                      paddingRight: 1,
                    }
                  : {}),
              }}
              onMouseEnter={() => {
                onHoverChange({
                  key: cellKey,
                  segmentStart: segment.start,
                  type: primaryType,
                });
              }}
              onMouseLeave={() => {
                onHoverChange(null);
              }}
            >
              {segment.text}
            </span>
          </span>
        );
      })}
      {clipped.suffixEllipsis ? <span className="ml-1 text-description">...</span> : null}
      {row.quoteType ? (
        <span className="ml-1 rounded-sm border border-surface-border bg-panel px-1 py-0.5 align-baseline text-badge text-description">
          {row.quoteType}
        </span>
      ) : null}
    </span>
  );
}
