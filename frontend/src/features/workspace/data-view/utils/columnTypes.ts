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
 * Map a raw backend dtype string to a canonical UI type. Falls back to
 * `'string'` for unknown/missing input — most components render strings
 * safely, so this is the least-surprising default.
 */
/** Used by: src/features/views/ai-annotator/AiAnnotatorFeature.tsx, src/features/views/common/useNodeColumnOptions.ts, src/features/views/sequential-analysis/SequentialAnalysisFeature.tsx and 6 other importers because the utility needs local normalization steps before returning a shared result. */
export const normalizeTypeName = (type?: string | null): string => {
  if (!type || typeof type !== 'string') return 'string';
  const s = type.toLowerCase();
  for (const [match, label] of TYPE_RULES) {
    if (match(s)) return label;
  }
  return 'string';
};

/** Reads the dtype field from whichever schema-entry shape a backend route returned. */
/** Called by: normalizeTypeName and mapColumnsToInfo in this utility module because the utility needs local normalization steps before returning a shared result. */
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
 * - `columns`: plain string[] (types fall back to `'string'`).
 *
 * If multiple sources disagree we keep the earliest non-`string` answer,
 * because the generic `columns` list is the weakest evidence.
 */
/**
 * Used by: src/features/views/common/useNodeColumnOptions.ts, src/features/views/preprocessing/aggregate/hooks/useAggregateSubTab.ts, src/features/views/preprocessing/replace/hooks/useReplaceSubTab.ts and 2 other importers because the utility needs local normalization steps before returning a shared result.
 * Flow: validate inputs, normalize values, branch on runtime conditions, then return the shared result.
 */
export const mapColumnsToInfo = (node: unknown): ColumnInfo[] => {
  if (!node) return [];

  const n = node as Record<string, unknown>;

  const columnOrder: string[] = [];
  const typeMap = new Map<string, string>();

  /** Merges column order and dtype evidence while preserving the first reliable column position. */
  /**
   * Called by: normalizeTypeName and mapColumnsToInfo in this utility module because the utility needs local normalization steps before returning a shared result.
   * Flow: validate inputs, normalize values, branch on runtime conditions, then return the shared result.
   */
  const register = (name: unknown, rawType?: unknown) => {
    if (typeof name !== 'string' || !name) return;
    const normalizedType = normalizeTypeName(
      typeof rawType === 'string'
        ? rawType
        : rawType != null
          ? // eslint-disable-next-line @typescript-eslint/no-base-to-string -- rawType is a backend dtype value; default coercion is intended
            String(rawType)
          : typeMap.get(name),
    );

    if (!typeMap.has(name)) {
      columnOrder.push(name);
      typeMap.set(name, normalizedType);
      return;
    }

    const existingType = typeMap.get(name) ?? 'string';
    if (existingType === 'string' && normalizedType !== 'string') {
      typeMap.set(name, normalizedType);
    }
  };

  const schema = (n.data as Record<string, unknown> | undefined)?.schema ?? n.schema;
  if (Array.isArray(schema)) {
    schema.forEach((entry: Record<string, unknown>) =>
      { register(entry.name, entry.js_type ?? entry.type ?? entry.dtype); },
    );
  } else if (schema && typeof schema === 'object') {
    Object.entries(schema as Record<string, unknown>).forEach(([name, entry]) => {
      register(name, extractTypeFromSchemaEntry(entry));
    });
  }

  const dtypes = (n.data as Record<string, unknown> | undefined)?.dtypes ?? n.dtypes;
  if (dtypes && typeof dtypes === 'object') {
    Object.entries(dtypes).forEach(([name, dtype]) => { register(name, dtype); });
  }

  const columns = (n.data as Record<string, unknown> | undefined)?.columns ?? n.columns;
  if (Array.isArray(columns)) {
    columns.forEach((name: unknown) => { register(name); });
  }

  return columnOrder.map((name) => ({ name, dataType: typeMap.get(name) ?? 'string' }));
};

/**
 * Narrow `columns` to entries whose `dataType` appears in `allowedTypes`.
 * If `allowedTypes` is empty the list is returned as-is (no-op filter).
 */
/** Used by: src/features/views/common/useNodeColumnOptions.ts, src/hooks/useAutoNodeColumns.ts because the utility needs local normalization steps before returning a shared result. */
export const filterColumnsByType = (
  columns: ColumnInfo[],
  allowedTypes: string[],
): ColumnInfo[] => {
  if (!allowedTypes.length) return columns;
  const allowed = new Set(allowedTypes.map((t) => t.toLowerCase()));
  return columns.filter((column) => allowed.has(column.dataType.toLowerCase()));
};
