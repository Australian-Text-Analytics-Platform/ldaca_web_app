import type { ExpressionItemInput, PolarsExpressionRequest } from '@/api';

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
  | {
      id: string;
      kind: 'column';
      column: string;
      dtype: string;
      operations: AggregateOperation[];
    }
  | { id: string; kind: 'custom'; value: string };

export type AggregateOperation = 'count' | 'mean' | 'sum';

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

type ExpressionSpec = ExpressionItemInput['expression'];

const customTokenValue = (value: string): string | number => {
  if (!value.length) return '';
  const trimmed = value.trim();
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (typeof parsed === 'string') return parsed;
    } catch {
      // Preserve malformed quoted input as literal text instead of executing it.
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }
  return value;
};

const tokenExpression = (token: AggregateBuilderToken): ExpressionSpec => {
  if (token.kind === 'custom') {
    return { op: 'literal', value: customTokenValue(token.value) };
  }

  return token.operations.reduce<ExpressionSpec>(
    (operand, operation) => ({ op: operation, operand }),
    { op: 'column', name: token.column },
  );
};

const aggregateExpression = (tokens: AggregateBuilderToken[]): ExpressionSpec => {
  const [first, ...rest] = tokens;
  if (!first) throw new Error('Add at least one column or literal');
  return rest.reduce<ExpressionSpec>(
    (left, token) => ({ op: 'add', left, right: tokenExpression(token) }),
    tokenExpression(first),
  );
};

/**
 * Builds the backend with_columns request from the visual builder's typed
 * tokens. Preview and apply therefore share the generated API contract and no
 * executable Polars source crosses the HTTP boundary.
 */
export function buildAggregateExpressionRequest(
  tokens: AggregateBuilderToken[],
  columnName: string,
): PolarsExpressionRequest {
  const columnValue = columnName.trim();
  return {
    context: 'with_columns',
    expressions: [
      {
        expression: aggregateExpression(tokens),
        alias: columnValue || null,
      },
    ],
  };
}
