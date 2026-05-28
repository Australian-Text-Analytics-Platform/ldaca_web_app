import React from 'react';

import { QUOTATION_COLUMN_KEYS } from '../../common/generatedColumns';

const TYPE_COLORS: Record<string, string> = {
  speaker: '#2563eb',
  quote: '#059669',
  verb: '#7c3aed',
};

type HighlightSpan = { start: number; end: number; types: string[] };

// Used by: renderQuotationDetailText to build stacked underline decorations for the full-text detail view because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules.
const buildUnderlineStyle = (types: string[]): React.CSSProperties => {
  if (!types.length) return {};
  const decorations = types.map(() => 'underline').join(' ');
  const colors = types.map((t) => TYPE_COLORS[t] || '#111827');
  return {
    textDecorationLine: decorations as string,
    textDecorationColor: colors.join(' ') as string,
    textDecorationThickness: '2px',
    textUnderlineOffset: '4px',
    textDecorationSkipInk: 'none',
    display: 'inline',
  } as React.CSSProperties;
};

/**
 * Called by: QuotationFeature detail panel renderDocumentText to render highlighted full text because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules.
 * Shows speaker (blue), quote (green), and verb (purple) spans
 * with underline decorations and inline label badges. No clipping.
 * Flow: normalize incoming props, derive display state, connect event handlers, then render the shared analysis UI.
 */
export const renderQuotationDetailText = (
  text: string,
  row: Record<string, unknown>,
): React.ReactNode => {
  if (typeof text !== 'string' || !text.length) return text ?? '';

  const spans: HighlightSpan[] = [];
  // Used by: renderQuotationDetailText to convert quotation span columns into detail-view highlight ranges because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules.
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

  if (Array.isArray(row?.__spans) && row.__spans.length > 0) {
    (row.__spans as Array<Record<string, unknown>>).forEach((s) =>
      addSpan(s?.start, s?.end, s?.type as string | undefined),
    );
  } else {
    addSpan(
      row?.[QUOTATION_COLUMN_KEYS.speakerStartIdx],
      row?.[QUOTATION_COLUMN_KEYS.speakerEndIdx],
      'speaker',
    );
    addSpan(
      row?.[QUOTATION_COLUMN_KEYS.quoteStartIdx],
      row?.[QUOTATION_COLUMN_KEYS.quoteEndIdx],
      'quote',
    );
    addSpan(
      row?.[QUOTATION_COLUMN_KEYS.verbStartIdx],
      row?.[QUOTATION_COLUMN_KEYS.verbEndIdx],
      'verb',
    );
  }

  if (!spans.length) return text;

  const bounds = new Set<number>([0, text.length]);
  spans.forEach((s) => {
    bounds.add(s.start);
    bounds.add(s.end);
  });
  const points = Array.from(bounds).sort((a, b) => a - b);

  const segs: Array<{ start: number; end: number; types: string[] }> = [];
  for (let i = 0; i < points.length - 1; i++) {
    const s = points[i]!;
    const e = points[i + 1]!;
    if (e <= s) continue;
    const covering = spans.filter((sp) => sp.start < e && sp.end > s).flatMap((sp) => sp.types);
    segs.push({ start: s, end: e, types: Array.from(new Set(covering)) });
  }

  return (
    <span>
      {segs.map((seg, i) => {
        const str = text.slice(seg.start, seg.end);
        if (!seg.types.length) return <span key={i}>{str}</span>;

        const style = buildUnderlineStyle(seg.types);
        const labels = seg.types.map((t, idx) => (
          <span
            key={idx}
            className="text-[10px] font-semibold px-1 py-0.5 rounded border mr-1 align-baseline"
            style={{
              color: '#0f172a',
              borderColor: TYPE_COLORS[t] || '#334155',
              backgroundColor: '#f1f5f9',
            }}
          >
            {t.toUpperCase()}
          </span>
        ));

        return (
          <span key={i}>
            {labels}
            <span style={style}>{str}</span>
          </span>
        );
      })}
      {row?.[QUOTATION_COLUMN_KEYS.quoteType] ? (
        <span className="ml-1 align-baseline text-[10px] px-1 py-0.5 rounded bg-gray-100 text-gray-600 border border-gray-200">
          {String(row[QUOTATION_COLUMN_KEYS.quoteType])}
        </span>
      ) : null}
    </span>
  );
};
