import type { PolarsExpressionRequest } from '@/api';

const SMART_CHAR_MAP: Record<string, string> = {
  '\u201C': '"',
  '\u201D': '"',
  '\u201E': '"',
  '\u201F': '"',
  '\u2018': "'",
  '\u2019': "'",
  '\u201A': "'",
  '\u201B': "'",
};

export type AggregateBuilderToken =
  | { id: string; kind: 'column'; column: string; dtype: string; operations: string[] }
  | { id: string; kind: 'custom'; value: string };

/**
 * Normalizes smart quotes before expressions reach the backend parser.
 * Used by: useAggregateSubTab and aggregate expression model tests so pasted
 * prose does not break generated Polars code unexpectedly.
 */
export const normalizeSmartCharacters = (input: string): string =>
  input.replace(
    /[\u201C\u201D\u201E\u201F\u2018\u2019\u201A\u201B]/g,
    (char) => SMART_CHAR_MAP[char] ?? char,
  );

/**
 * Escapes a string for use inside generated double-quoted Polars code.
 * Called by: token and request serializers in this module.
 */
const escapeDoubleQuotedPolarsString = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/**
 * Converts one aggregate builder token into a Polars expression fragment.
 * Used by: useAggregateSubTab when mirroring builder tokens into the expression
 * preview and backend request payload.
 */
export function tokenToPolarsExpression(token: AggregateBuilderToken): string {
  if (token.kind === 'column') {
    let expr = `pl.col("${escapeDoubleQuotedPolarsString(token.column)}")`;
    for (const op of token.operations) {
      expr += `.${op}()`;
    }
    return expr;
  }

  const raw = token.value;
  if (!raw.length) return 'pl.lit("")';
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return `pl.lit(${trimmed})`;
  }
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return `pl.lit(${trimmed})`;
  }
  return `pl.lit("${escapeDoubleQuotedPolarsString(raw)}")`;
}

/**
 * Joins all builder token fragments into the expression shown in the preview.
 * Used by: useAggregateSubTab after token add/remove/reorder/operation edits.
 */
export const tokensToPolarsExpression = (tokens: AggregateBuilderToken[]): string =>
  tokens.map(tokenToPolarsExpression).join(' + ');

/**
 * Builds the backend with_columns request from a committed expression and
 * optional output column alias.
 * Used by: aggregate preview and apply flows so both paths share one payload
 * shape and alias-escaping rule.
 */
export function buildAggregateExpressionRequest(
  expression: string,
  columnName: string,
): PolarsExpressionRequest {
  const expressionValue = expression.trim();
  const columnValue = columnName.trim();
  let code = expressionValue;
  if (columnValue.length > 0) {
    code = `(${code}).alias("${escapeDoubleQuotedPolarsString(columnValue)}")`;
  }
  return {
    context: 'with_columns',
    expressions: [{ code }],
  };
}
