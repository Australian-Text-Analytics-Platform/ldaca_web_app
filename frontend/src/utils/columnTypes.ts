/**
 * Represents column metadata including name and data type
 */
export interface ColumnInfo {
  name: string;
  dataType: string;
}

/**
 * Normalizes various data type representations into standardized type names.
 * Handles Polars, Pandas, and generic type strings.
 * 
 * @param type - Raw type string from backend (e.g., 'Utf8', 'Int64', 'Datetime')
 * @returns Normalized type name ('string', 'integer', 'float', 'datetime', 'boolean', 'categorical', 'list_string', 'annotation', 'unknown', 'struct')
 * 
 * @example
 * ```ts
 * normalizeTypeName('Utf8') // 'string'
 * normalizeTypeName('Int64') // 'integer'
 * normalizeTypeName('Float64') // 'float'
 * normalizeTypeName('Datetime') // 'datetime'
 * ```
 */
export const normalizeTypeName = (type?: string | null): string => {
  if (!type || typeof type !== 'string') {
    return 'string';
  }

  const lowercaseType = type.toLowerCase();

  if (
    lowercaseType === 'annotation' ||
    (lowercaseType.includes('list') &&
      lowercaseType.includes('struct') &&
      lowercaseType.includes('provider') &&
      lowercaseType.includes('annotation'))
  ) {
    return 'annotation';
  }

  if (
    lowercaseType === 'list_string' ||
    lowercaseType.includes('list(string') ||
    lowercaseType.includes('list[utf8') ||
    lowercaseType.includes('list[str')
  ) {
    return 'list_string';
  }

  if (lowercaseType.includes('utf8') || lowercaseType.includes('string') || lowercaseType.includes('str')) {
    return 'string';
  }
  if (lowercaseType.includes('datetime') || lowercaseType.includes('timestamp')) {
    return 'datetime';
  }
  if (lowercaseType.includes('date') && !lowercaseType.includes('update')) {
    return 'datetime';
  }
  if (lowercaseType.includes('time') && !lowercaseType.includes('interval')) {
    return 'datetime';
  }
  if (lowercaseType.includes('categorical') || lowercaseType.includes('category')) {
    return 'categorical';
  }
  if (lowercaseType.includes('list') || lowercaseType.includes('array')) {
    return 'unknown';
  }
  if (lowercaseType.includes('bool')) {
    return 'boolean';
  }
  if (lowercaseType.includes('int') && !lowercaseType.includes('interval')) {
    return 'integer';
  }
  if (lowercaseType.includes('float') || lowercaseType.includes('double')) {
    return 'float';
  }
  if (lowercaseType.includes('decimal') || lowercaseType.includes('numeric')) {
    return 'float';
  }
  if (lowercaseType.includes('json') || lowercaseType.includes('struct') || lowercaseType.includes('map')) {
    return 'struct';
  }

  if (lowercaseType.includes('unknown')) {
    return 'unknown';
  }

  return 'string';
};

/**
 * Extracts type information from a schema entry object
 * @param entry - Schema entry from backend (string, object with js_type/type/dtype fields)
 * @returns Type string if found, undefined otherwise
 * @internal
 */
const extractTypeFromSchemaEntry = (entry: unknown): string | undefined => {
  if (!entry) return undefined;
  if (typeof entry === 'string') return entry;
  if (typeof entry === 'object' && entry !== null) {
    const e = entry as Record<string, unknown>;
    return (e.js_type as string) || (e.type as string) || (e.dtype as string);
  }
  return undefined;
};

/**
 * Extracts column names and data types from a workspace node object.
 * Handles multiple schema formats from backend (schema array, dtypes object, columns array).
 * 
 * @param node - Workspace node object containing schema/dtypes/columns metadata
 * @returns Array of ColumnInfo objects with name and normalized dataType
 * 
 * @example
 * ```ts
 * const columns = getColumnsWithTypesFromNode(nodeData);
 * // [{ name: 'id', dataType: 'integer' }, { name: 'text', dataType: 'string' }]
 * ```
 */
export const getColumnsWithTypesFromNode = (node: unknown): ColumnInfo[] => {
  if (!node) return [];

  const n = node as Record<string, unknown>;

  const columnOrder: string[] = [];
  const typeMap = new Map<string, string>();

  const register = (name: unknown, rawType?: unknown) => {
    if (typeof name !== 'string' || !name) return;
    const normalizedType = normalizeTypeName(
      typeof rawType === 'string'
        ? rawType
        : rawType != null
          ? String(rawType)
          : typeMap.get(name) || undefined
    );

    if (!typeMap.has(name)) {
      columnOrder.push(name);
      typeMap.set(name, normalizedType);
      return;
    }

    const existingType = typeMap.get(name) || 'string';
    if (existingType === 'string' && normalizedType !== 'string') {
      typeMap.set(name, normalizedType);
    }
  };

  const schema = (n?.data as Record<string, unknown>)?.schema ?? n?.schema;
  if (Array.isArray(schema)) {
    schema.forEach((entry: Record<string, unknown>) => register(entry?.name, entry?.js_type || entry?.type || entry?.dtype));
  } else if (schema && typeof schema === 'object') {
    Object.entries(schema as Record<string, unknown>).forEach(([name, entry]) => {
      register(name, extractTypeFromSchemaEntry(entry));
    });
  }

  const dtypes = (n?.data as Record<string, unknown>)?.dtypes ?? n?.dtypes;
  if (dtypes && typeof dtypes === 'object') {
    Object.entries(dtypes).forEach(([name, dtype]) => register(name, dtype));
  }

  const columns = (n?.data as Record<string, unknown>)?.columns ?? n?.columns;
  if (Array.isArray(columns)) {
    columns.forEach((name: unknown) => register(name));
  }

  return columnOrder.map((name) => ({ name, dataType: typeMap.get(name) || 'string' }));
};

export const filterColumnsByType = (columns: ColumnInfo[], allowedTypes: string[]): ColumnInfo[] => {
  if (!allowedTypes.length) return columns;
  const allowed = new Set(allowedTypes.map((t) => t.toLowerCase()));
  return columns.filter((column) => allowed.has(column.dataType.toLowerCase()));
};

export const mapColumnsToInfo = (node: unknown): ColumnInfo[] => getColumnsWithTypesFromNode(node);
