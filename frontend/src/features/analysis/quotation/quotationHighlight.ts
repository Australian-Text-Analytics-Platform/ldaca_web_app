/**
 * Highlight palette + style helpers for the quotation feature. Pulled out
 * of QuotationFeature.tsx so the highlight cell component can consume the
 * same colours/decorations without importing the feature module.
 */

import type { CSSProperties } from 'react';

export type QuotationHighlightType = 'speaker' | 'quote' | 'verb';

export const TYPE_COLORS: Record<string, string> = {
  speaker: '#2563eb', // blue-600
  quote: '#059669',   // emerald-600
  verb: '#7c3aed',    // violet-600
};

export const hexToRgba = (hex: string, alpha = 0.18): string => {
  const h = hex.replace('#', '');
  const bigint = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

/**
 * Build multi-line-safe text decorations for a stacked set of highlight
 * types. Each type contributes one underline coloured per `TYPE_COLORS`
 * so overlapping spans render as parallel lines.
 */
export const buildUnderlineStyle = (types: string[]): CSSProperties => {
  if (!types.length) return {};
  const decorations = types.map(() => 'underline').join(' ');
  const colors = types.map((t) => TYPE_COLORS[t] || '#111827');
  return {
    textDecorationLine: decorations,
    textDecorationColor: colors.join(' '),
    textDecorationThickness: '2px',
    textUnderlineOffset: '4px',
    textDecorationSkipInk: 'none',
    display: 'inline',
  };
};
