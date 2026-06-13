/**
 * Renders an unknown quotation cell value as display text without producing
 * `[object Object]` from a default object stringification.
 *
 * Quotation result rows are `Record<string, unknown>`, so cell values are typed
 * `unknown`. This helper narrows by `typeof` before stringifying so the typed
 * `no-base-to-string` lint rule is satisfied while preserving runtime output for
 * the scalar values the backend actually returns.
 *
 * Used by: QuotationFeature.tsx (row-detail dialog field mapping and full-text
 * derivation) and QuotationNodeBlock.tsx (highlighted/plain cell renderers),
 * which both read raw backend cell values typed `unknown`.
 */
export const toCellText = (value: unknown): string => {
  if (value == null) return '';
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
};
