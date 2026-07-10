import React from 'react';

import { QUOTATION_COLUMN_KEYS } from '../../common/generatedColumns';
import {
  buildUnderlineStyle,
  hexToRgba,
  TYPE_COLORS,
  type QuotationHighlightType,
} from '../quotationHighlight';
import { clipTextAroundSpans, type HighlightSpan } from '../quotationTextClip';

export interface QuotationHoverState {
  key: string;
  segIndex: number;
  type?: QuotationHighlightType;
}

export interface QuotationHighlightedCellProps {
  text: string;
  row: Record<string, unknown>;
  cellKey: string;
  contextLength: number;
  hoverState: QuotationHoverState | null;
  onHoverChange: (state: QuotationHoverState | null) => void;
}

const PRIORITY_ORDER: QuotationHighlightType[] = ['quote', 'speaker', 'verb'];

// Used by: QuotationHighlightedCell hover rendering when multiple quotation span types overlap.
const choosePriorityType = (types: string[]): QuotationHighlightType => {
  for (const t of PRIORITY_ORDER) {
    if (types.includes(t)) return t;
  }
  return (types[0] ?? 'quote') as QuotationHighlightType;
};

/**
 * Rendered by `QuotationFeature` for each quotation source cell. It draws
 * multi-coloured speaker/quote/verb underlines, labels, and hover highlights.
 *
 * Extracted from the 116-LoC closure in QuotationFeature.tsx so the cell
 * has a stable component identity and the hover handlers no longer
 * capture the parent's `setHoverState` directly.
 */
export function QuotationHighlightedCell({
  text,
  row,
  cellKey,
  contextLength,
  hoverState,
  onHoverChange,
}: QuotationHighlightedCellProps) {
  if (typeof text !== 'string' || !text.length) {
    return <>{text}</>;
  }

  const spans: HighlightSpan[] = [];
  // Used by: QuotationHighlightedCell to convert backend span coordinates into clipped table-cell ranges.
  const addSpan = (start?: unknown, end?: unknown, type?: string) => {
    if (
      type &&
      Number.isFinite(start) &&
      Number.isFinite(end) &&
      (start as number) < (end as number) &&
      (start as number) >= 0 &&
      (end as number) <= text.length
    ) {
      spans.push({ start: Number(start), end: Number(end), types: [type] });
    }
  };

  if (Array.isArray(row.__spans) && row.__spans.length > 0) {
    (row.__spans as Record<string, unknown>[]).forEach((s) => {
      addSpan(s.start, s.end, s.type as string | undefined);
    });
  } else {
    addSpan(
      row[QUOTATION_COLUMN_KEYS.speakerStartIdx],
      row[QUOTATION_COLUMN_KEYS.speakerEndIdx],
      'speaker',
    );
    addSpan(
      row[QUOTATION_COLUMN_KEYS.quoteStartIdx],
      row[QUOTATION_COLUMN_KEYS.quoteEndIdx],
      'quote',
    );
    addSpan(row[QUOTATION_COLUMN_KEYS.verbStartIdx], row[QUOTATION_COLUMN_KEYS.verbEndIdx], 'verb');
  }

  if (!spans.length) return <>{text}</>;

  const clipped = clipTextAroundSpans(text, spans, contextLength);
  let workingText = clipped.text;
  let workingSpans = clipped.spans;
  if (!workingSpans.length) {
    workingText = text.slice(clipped.sliceStart, clipped.sliceEnd);
    workingSpans = spans
      .map((span) => {
        const start = Math.max(span.start, clipped.sliceStart);
        const end = Math.min(span.end, clipped.sliceEnd);
        if (end <= start) return null;
        return { ...span, start: start - clipped.sliceStart, end: end - clipped.sliceStart };
      })
      .filter((span): span is HighlightSpan => Boolean(span));
  }

  const bounds = new Set<number>([0, workingText.length]);
  workingSpans.forEach((s) => {
    bounds.add(s.start);
    bounds.add(s.end);
  });
  const points = Array.from(bounds).sort((a, b) => a - b);

  const segs: { start: number; end: number; types: string[] }[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const s = points[i];
    const e = points[i + 1];
    if (s === undefined || e === undefined || e <= s) continue;
    const covering = workingSpans
      .filter((sp) => sp.start < e && sp.end > s)
      .flatMap((sp) => sp.types);
    segs.push({ start: s, end: e, types: Array.from(new Set(covering)) });
  }

  // Used by: QuotationHighlightedCell segment rendering because overlapping span badges must reflect hover state and forward hover changes per segment. Flow: skip empty type lists, render one badge per type with hover-aware colors, then wire mouse enter/leave to shared hover state.
  const renderLabels = (types: string[], segIndex: number) => {
    if (!types.length) return null;
    return types.map((t, idx) => (
      <span
        key={idx}
        className="text-[10px] font-semibold px-1 py-0.5 rounded border mr-1 align-baseline cursor-pointer"
        style={{
          color: '#0f172a',
          borderColor: TYPE_COLORS[t] ?? '#334155',
          backgroundColor:
            hoverState?.key === cellKey && hoverState.segIndex === segIndex && hoverState.type === t
              ? hexToRgba(TYPE_COLORS[t] ?? '#cbd5e1', 0.28)
              : '#f1f5f9',
        }}
        onMouseEnter={() => {
          onHoverChange({ key: cellKey, segIndex, type: t as QuotationHighlightType });
        }}
        onMouseLeave={() => {
          onHoverChange(null);
        }}
      >
        {t.toUpperCase()}
      </span>
    ));
  };

  return (
    <span>
      {clipped.prefixEllipsis && <span className="mr-1 text-muted-foreground">...</span>}
      {segs.map((seg, i) => {
        const str = workingText.slice(seg.start, seg.end);
        if (!seg.types.length) return <span key={i}>{str}</span>;
        const style = buildUnderlineStyle(seg.types);
        const isHoveredSeg = hoverState?.key === cellKey && hoverState.segIndex === i;
        const colorForSeg =
          hoverState?.type && isHoveredSeg && seg.types.includes(hoverState.type)
            ? hoverState.type
            : undefined;
        const bgStyle: React.CSSProperties = isHoveredSeg
          ? {
              backgroundColor: hexToRgba(TYPE_COLORS[colorForSeg ?? 'quote'] ?? '#cbd5e1', 0.22),
              borderRadius: 3,
              paddingLeft: 1,
              paddingRight: 1,
            }
          : {};
        const segHoverType = choosePriorityType(seg.types);
        return (
          <span key={i}>
            {renderLabels(seg.types, i)}
            <span
              style={{ ...style, ...bgStyle }}
              onMouseEnter={() => {
                onHoverChange({ key: cellKey, segIndex: i, type: segHoverType });
              }}
              onMouseLeave={() => {
                onHoverChange(null);
              }}
            >
              {str}
            </span>
          </span>
        );
      })}
      {clipped.suffixEllipsis && <span className="ml-1 text-muted-foreground">...</span>}
      {row[QUOTATION_COLUMN_KEYS.quoteType] ? (
        <span className="ml-1 align-baseline text-[10px] px-1 py-0.5 rounded bg-gray-100 text-gray-600 border border-gray-200">
          {String(row[QUOTATION_COLUMN_KEYS.quoteType])}
        </span>
      ) : null}
    </span>
  );
}
