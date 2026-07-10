/**
 * Normalization helpers for column metadata returned by the backend.
 *
 * The backend reports dtypes in several wire formats (Polars `Utf8`,
 * pandas `float64`, nested `List[Struct[...]]`, etc.). Hooks and feature
 * components work with a small, closed set of canonical type names so UI
 * controls (filter builder, concordance column picker) don't have to know
 * the raw dialect. This module is that translation layer.
 */

export interface ColumnInfo {
  name: string;
  /** Canonical type. See `normalizeTypeName` for the full set. */
  dataType: string;
}

/**
 * Ordered list of `(matcher → canonical type)` rules. First match wins, so
 * keep the most specific patterns on top.
 *
 * Canonical types: `tmdist`, `annotation`, `list[string]`, `string`, `datetime`,
 * `boolean`, `integer`, `float`, `categorical`, `struct`, `unknown`.
 */
const TYPE_RULES: [(s: string) => boolean, string][] = [
  [
    (s) =>
      s === 'tmdist' ||
      (s.includes('list') &&
        s.includes('struct') &&
        s.includes('topic_id') &&
        s.includes('proportion')),
    'tmdist',
  ],
  [
    (s) =>
      s === 'annotation' ||
      (s.includes('list') &&
        s.includes('struct') &&
        s.includes('provider') &&
        s.includes('annotation')),
    'annotation',
  ],
  [
    (s) =>
      s === 'list[string]' ||
      s === 'list_string' ||
      s.includes('list(string') ||
      s.includes('list[utf8') ||
      s.includes('list[str'),
    'list[string]',
  ],
  [(s) => s.includes('utf8') || s.includes('string') || s.includes('str'), 'string'],
  [(s) => s.includes('datetime') || s.includes('timestamp'), 'datetime'],
  [(s) => s.includes('date') && !s.includes('update'), 'datetime'],
  [(s) => s.includes('time') && !s.includes('interval'), 'datetime'],
  [(s) => s.includes('categorical') || s.includes('category'), 'categorical'],
  [(s) => s.includes('list') || s.includes('array'), 'unknown'],
  [(s) => s.includes('bool'), 'boolean'],
  [(s) => s.includes('int') && !s.includes('interval'), 'integer'],
  [(s) => s.includes('float') || s.includes('double'), 'float'],
  [(s) => s.includes('decimal') || s.includes('numeric'), 'float'],
  [(s) => s.includes('json') || s.includes('struct') || s.includes('map'), 'struct'],
  [(s) => s.includes('unknown'), 'unknown'],
];

/**
 * Map a raw backend dtype string to a canonical UI type. Missing or
 * unrecognized input is `unknown`; callers that need a string default should
 * pass that default explicitly before calling this helper.
 */
/** Used by: workspace table/cast controls, preprocessing type helpers, node-info hooks, and sequential-analysis column typing. */
export const normalizeTypeName = (type?: string | null): string => {
  if (!type || typeof type !== 'string') return 'unknown';
  const s = type.toLowerCase();
  for (const [match, label] of TYPE_RULES) {
    if (match(s)) return label;
  }
  return 'unknown';
};

/**
 * Extracts ordered column metadata from the generated workspace node contract
 * (or its handwritten `WorkspaceNodeMetadata` projection). `schema` is the
 * only dtype source; `columns` supplies stable order and unknown fallbacks.
 */
/**
 * Used by: useNodeColumnInfos, aggregate/replace preprocessing hooks, and
 * add-node input resolution because they need one backend-schema normalization
 * boundary before filtering or rendering column choices.
 * Flow: read the canonical schema and explicit column order, append schema-only
 * names, then normalize each generated dtype for the handwritten controls.
 */
export const mapColumnsToInfo = (
  node: { columns?: string[]; schema?: Record<string, string> } | null | undefined,
): ColumnInfo[] => {
  if (!node) return [];
  const schema = node.schema ?? {};
  const columns = node.columns ?? [];
  const orderedNames = [
    ...columns,
    ...Object.keys(schema).filter((name) => !columns.includes(name)),
  ];
  return orderedNames.map((name) => ({
    name,
    dataType: normalizeTypeName(schema[name]),
  }));
};

/**
 * Narrow `columns` to entries whose `dataType` appears in `allowedTypes`.
 * If `allowedTypes` is empty the list is returned as-is (no-op filter).
 */
/** Used by: shared column selectors and schema/type-management helpers. */
export const filterColumnsByType = (
  columns: ColumnInfo[],
  allowedTypes: string[],
): ColumnInfo[] => {
  if (!allowedTypes.length) return columns;
  const allowed = new Set(allowedTypes.map((t) => t.toLowerCase()));
  return columns.filter((column) => allowed.has(column.dataType.toLowerCase()));
};
