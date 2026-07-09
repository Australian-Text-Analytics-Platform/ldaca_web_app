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

/** Reads the dtype field from whichever schema-entry shape a backend route returned. */
/** Called by: normalizeTypeName and mapColumnsToInfo in this utility module. */
const extractTypeFromSchemaEntry = (entry: unknown): string | undefined => {
  if (!entry) return undefined;
  if (typeof entry === 'string') return entry;
  if (typeof entry === 'object') {
    const e = entry as Record<string, unknown>;
    return (e.js_type as string) || (e.type as string) || (e.dtype as string);
  }
  return undefined;
};

/**
 * Extract an ordered `ColumnInfo[]` from a workspace-node-ish object,
 * merging whichever metadata shape the backend returned:
 * - `schema`: array of `{name, js_type|type|dtype}` OR object keyed by column.
 * - `dtypes`: object keyed by column.
 * - `columns`: plain string[] (types are `unknown` without schema/dtype evidence).
 *
 * If multiple sources disagree we keep the earliest concrete answer because
 * the generic `columns` list is the weakest evidence.
 */
/**
 * Used by: useNodeColumnInfos, aggregate/replace preprocessing hooks, and
 * add-node input resolution because they need one backend-schema normalization
 * boundary before filtering or rendering column choices.
 * Flow: gather schema/dtypes/column names, register columns in stable order,
 * promote unknown entries only when later dtype evidence exists, then return the
 * normalized list.
 */
export const mapColumnsToInfo = (node: unknown): ColumnInfo[] => {
  if (!node) return [];

  const n = node as Record<string, unknown>;

  const columnOrder: string[] = [];
  const typeMap = new Map<string, string>();

  /** Merges column order and dtype evidence while preserving the first reliable column position. */
  /**
   * Called by: normalizeTypeName and mapColumnsToInfo in this utility module.
   * Flow: validate inputs, normalize values, branch on runtime conditions, then return the shared result.
   */
  const register = (name: unknown, rawType?: unknown) => {
    if (typeof name !== 'string' || !name) return;
    const normalizedType =
      rawType == null
        ? (typeMap.get(name) ?? 'unknown')
        : normalizeTypeName(
            typeof rawType === 'string'
              ? rawType
              : // eslint-disable-next-line @typescript-eslint/no-base-to-string -- rawType is a backend dtype value; default coercion is intended
                String(rawType),
          );

    if (!typeMap.has(name)) {
      columnOrder.push(name);
      typeMap.set(name, normalizedType);
      return;
    }

    const existingType = typeMap.get(name) ?? 'unknown';
    if (existingType === 'unknown' && normalizedType !== 'unknown') {
      typeMap.set(name, normalizedType);
    }
  };

  const schema = (n.data as Record<string, unknown> | undefined)?.schema ?? n.schema;
  if (Array.isArray(schema)) {
    schema.forEach((entry: Record<string, unknown>) => {
      register(entry.name, entry.js_type ?? entry.type ?? entry.dtype);
    });
  } else if (schema && typeof schema === 'object') {
    Object.entries(schema as Record<string, unknown>).forEach(([name, entry]) => {
      register(name, extractTypeFromSchemaEntry(entry));
    });
  }

  const dtypes = (n.data as Record<string, unknown> | undefined)?.dtypes ?? n.dtypes;
  if (dtypes && typeof dtypes === 'object') {
    Object.entries(dtypes).forEach(([name, dtype]) => {
      register(name, dtype);
    });
  }

  const columns = (n.data as Record<string, unknown> | undefined)?.columns ?? n.columns;
  if (Array.isArray(columns)) {
    columns.forEach((name: unknown) => {
      register(name);
    });
  }

  return columnOrder.map((name) => ({ name, dataType: typeMap.get(name) ?? 'unknown' }));
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
