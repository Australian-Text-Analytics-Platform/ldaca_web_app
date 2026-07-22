import type { CSSProperties } from 'react';

import { QUOTATION_COLUMN_KEYS, QUOTATION_DOCUMENT_COLUMN } from '../common/generatedColumns';

const QUOTATION_HIGHLIGHT_TYPES = ['quote', 'speaker', 'verb'] as const;
export type QuotationHighlightType = (typeof QUOTATION_HIGHLIGHT_TYPES)[number];

const QUOTATION_HIGHLIGHT_COLORS: Record<QuotationHighlightType, string> = {
  speaker: '#2563eb',
  quote: '#059669',
  verb: '#7c3aed',
};

export interface QuotationSpan {
  /** JavaScript UTF-16 code-unit offset, ready for String.slice. */
  start: number;
  /** JavaScript UTF-16 code-unit offset, ready for String.slice. */
  end: number;
  type: QuotationHighlightType;
}

export interface QuotationSegment {
  start: number;
  end: number;
  text: string;
  types: QuotationHighlightType[];
  primaryType: QuotationHighlightType | null;
}

export interface QuotationResultRow {
  raw: Record<string, unknown>;
  textColumn: string;
  text: string;
  quoteType: string;
  hasQuote: boolean;
  spans: QuotationSpan[];
  cellText: (column: string) => string;
}

const isQuotationHighlightType = (value: unknown): value is QuotationHighlightType =>
  typeof value === 'string' && QUOTATION_HIGHLIGHT_TYPES.some((candidate) => candidate === value);

/** Converts unknown backend scalar/JSON values into safe display text. */
const toQuotationCellText = (value: unknown): string => {
  if (value == null) return '';
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
};

/** Returns the stable product palette entry for one canonical highlight type. */
export const getQuotationHighlightColor = (type: QuotationHighlightType): string =>
  QUOTATION_HIGHLIGHT_COLORS[type];

/** Converts a canonical quotation color into the translucent hover color. */
export const quotationColorWithAlpha = (type: QuotationHighlightType, alpha = 0.18): string => {
  const hex = getQuotationHighlightColor(type).slice(1);
  const value = Number.parseInt(hex, 16);
  return `rgba(${String((value >> 16) & 255)}, ${String((value >> 8) & 255)}, ${String(
    value & 255,
  )}, ${String(alpha)})`;
};

/** Builds the shared stacked-underline style for table and detail adapters. */
export const buildQuotationUnderlineStyle = (
  types: readonly QuotationHighlightType[],
): CSSProperties => {
  if (types.length === 0) return {};
  return {
    textDecorationLine: types.map(() => 'underline').join(' '),
    textDecorationColor: types.map(getQuotationHighlightColor).join(' '),
    textDecorationThickness: '2px',
    textUnderlineOffset: '4px',
    textDecorationSkipInk: 'none',
    display: 'inline',
  };
};

/**
 * Converts Python code-point offsets from the backend into JavaScript code-unit
 * offsets once. This keeps astral Unicode characters aligned for every renderer.
 */
const buildCodePointOffsets = (text: string): number[] => {
  const offsets = [0];
  for (const character of text) {
    offsets.push((offsets[offsets.length - 1] ?? 0) + character.length);
  }
  return offsets;
};

const normalizeSpan = (
  offsets: number[],
  start: unknown,
  end: unknown,
  type: unknown,
): QuotationSpan | null => {
  if (
    !isQuotationHighlightType(type) ||
    typeof start !== 'number' ||
    typeof end !== 'number' ||
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end <= start
  ) {
    return null;
  }
  const normalizedStart = offsets[start];
  const normalizedEnd = offsets[end];
  if (normalizedStart === undefined || normalizedEnd === undefined) return null;
  return { start: normalizedStart, end: normalizedEnd, type };
};

/**
 * Normalizes one raw backend row into the only row/span shape used by table,
 * detail, filtering, and detachment UI code.
 */
export const normalizeQuotationRow = (
  raw: Record<string, unknown>,
  textColumn: string,
): QuotationResultRow => {
  const text = toQuotationCellText(raw[textColumn]);
  const offsets = buildCodePointOffsets(text);
  const spans: QuotationSpan[] = [];
  const addSpan = (start: unknown, end: unknown, type: unknown) => {
    const span = normalizeSpan(offsets, start, end, type);
    if (span) spans.push(span);
  };

  if (Array.isArray(raw.__spans)) {
    for (const candidate of raw.__spans) {
      if (!candidate || typeof candidate !== 'object') continue;
      const span = candidate as Record<string, unknown>;
      addSpan(span.start, span.end, span.type);
    }
  } else {
    addSpan(
      raw[QUOTATION_COLUMN_KEYS.speakerStartIdx],
      raw[QUOTATION_COLUMN_KEYS.speakerEndIdx],
      'speaker',
    );
    addSpan(
      raw[QUOTATION_COLUMN_KEYS.quoteStartIdx],
      raw[QUOTATION_COLUMN_KEYS.quoteEndIdx],
      'quote',
    );
    addSpan(raw[QUOTATION_COLUMN_KEYS.verbStartIdx], raw[QUOTATION_COLUMN_KEYS.verbEndIdx], 'verb');
  }

  return {
    raw,
    textColumn,
    text,
    quoteType: toQuotationCellText(raw[QUOTATION_COLUMN_KEYS.quoteType]),
    hasQuote: Boolean(raw[QUOTATION_COLUMN_KEYS.quote]),
    spans,
    cellText: (column) => toQuotationCellText(raw[column]),
  };
};

/** Segments canonical spans once, preserving deterministic type/palette order. */
export const buildQuotationSegments = (
  text: string,
  spans: readonly QuotationSpan[],
): QuotationSegment[] => {
  if (text.length === 0) return [];
  const boundaries = new Set<number>([0, text.length]);
  for (const span of spans) {
    boundaries.add(span.start);
    boundaries.add(span.end);
  }
  const points = Array.from(boundaries).sort((left, right) => left - right);
  const segments: QuotationSegment[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    if (start === undefined || end === undefined || end <= start) continue;
    const covering = new Set(
      spans.filter((span) => span.start < end && span.end > start).map((span) => span.type),
    );
    const types = QUOTATION_HIGHLIGHT_TYPES.filter((type) => covering.has(type));
    segments.push({
      start,
      end,
      text: text.slice(start, end),
      types,
      primaryType: types[0] ?? null,
    });
  }
  return segments;
};

interface QuotationResultMetadataSource {
  metadata: {
    metadata_columns?: string[];
    quotation_columns?: string[];
  };
}

const QUOTATION_GENERATED_METADATA_COLUMNS = [
  QUOTATION_COLUMN_KEYS.quote,
  QUOTATION_COLUMN_KEYS.speaker,
  QUOTATION_COLUMN_KEYS.speakerStartIdx,
  QUOTATION_COLUMN_KEYS.speakerEndIdx,
  QUOTATION_COLUMN_KEYS.quoteStartIdx,
  QUOTATION_COLUMN_KEYS.quoteEndIdx,
  QUOTATION_COLUMN_KEYS.verb,
  QUOTATION_COLUMN_KEYS.verbStartIdx,
  QUOTATION_COLUMN_KEYS.verbEndIdx,
  QUOTATION_COLUMN_KEYS.quoteType,
  QUOTATION_COLUMN_KEYS.quoteTokenCount,
  QUOTATION_COLUMN_KEYS.isFloatingQuote,
  QUOTATION_COLUMN_KEYS.quoteRowIdx,
];

/**
 * Builds the columns offered by the Quotation metadata selector. Backend
 * metadata columns come first, then generated quote/speaker/verb fields that
 * are actually present in the current result.
 * Used by: QuotationFeature before rendering MetadataColumnSelector so result
 * controls and table columns share one availability rule.
 */
export const buildQuotationMetadataColumns = (
  resultState: QuotationResultMetadataSource | null | undefined,
): string[] => {
  if (!resultState) return [];

  const baseColumns = (resultState.metadata.metadata_columns ?? []).filter(
    (column) => !column.startsWith('__'),
  );
  const generatedMetadataColumns = QUOTATION_GENERATED_METADATA_COLUMNS.filter((column) =>
    (resultState.metadata.quotation_columns ?? []).includes(column),
  );

  return Array.from(new Set([...baseColumns, ...generatedMetadataColumns]));
};

/**
 * Keeps explicit user metadata selections valid when a rerun changes result
 * shape.
 * Used by: QuotationFeature when passing selected metadata columns into the
 * result controls and QuotationNodeBlock display-column model.
 */
export const resolveQuotationMetadataColumns = (
  selectedColumns: string[],
  availableColumns: string[],
): string[] => {
  const available = new Set(availableColumns);
  return selectedColumns.filter((column) => available.has(column));
};

/**
 * Builds the ordered table columns for a Quotation result block. The document
 * pseudo-column always leads, followed by user-selected metadata when visible.
 * Used by: QuotationFeature before rendering each QuotationNodeBlock.
 */
export const buildQuotationDisplayColumns = (visibleMetadataColumns: string[]): string[] =>
  Array.from(new Set([QUOTATION_DOCUMENT_COLUMN, ...visibleMetadataColumns]));

/**
 * Removes source rows where the extractor returned no quotation hit. The
 * backend paginates by source documents, so the visible hit table can contain
 * fewer rows than the source page size.
 * Used by: QuotationFeature before handing rows to QuotationNodeBlock.
 */
export const filterQuotationRowsWithQuotes = (
  rows: QuotationResultRow[] | null | undefined,
): QuotationResultRow[] => (rows ?? []).filter((row) => row.hasQuote);
