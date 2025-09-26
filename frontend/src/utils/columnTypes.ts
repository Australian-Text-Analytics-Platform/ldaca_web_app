export interface ColumnInfo {
  name: string;
  dataType: string;
}

export const normalizeTypeName = (type?: string | null): string => {
  if (!type || typeof type !== 'string') {
    return 'string';
  }

  const lowercaseType = type.toLowerCase();

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
  if (lowercaseType.includes('list') || lowercaseType.includes('array')) {
    return 'array';
  }
  if (lowercaseType.includes('json') || lowercaseType.includes('struct') || lowercaseType.includes('map')) {
    return 'struct';
  }

  return 'string';
};

const extractTypeFromSchemaEntry = (entry: any): string | undefined => {
  if (!entry) return undefined;
  if (typeof entry === 'string') return entry;
  if (typeof entry === 'object') {
    return entry.js_type || entry.type || entry.dtype;
  }
  return undefined;
};

export const getColumnsWithTypesFromNode = (node: any): ColumnInfo[] => {
  if (!node) return [];

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

  const schema = node?.data?.schema ?? node?.schema;
  if (Array.isArray(schema)) {
    schema.forEach((entry: any) => register(entry?.name, entry?.js_type || entry?.type || entry?.dtype));
  } else if (schema && typeof schema === 'object') {
    Object.entries(schema as Record<string, unknown>).forEach(([name, entry]) => {
      register(name, extractTypeFromSchemaEntry(entry));
    });
  }

  const dtypes = node?.data?.dtypes ?? node?.dtypes;
  if (dtypes && typeof dtypes === 'object') {
    Object.entries(dtypes).forEach(([name, dtype]) => register(name, dtype));
  }

  const columns = node?.data?.columns ?? node?.columns;
  if (Array.isArray(columns)) {
    columns.forEach((name: any) => register(name));
  }

  return columnOrder.map((name) => ({ name, dataType: typeMap.get(name) || 'string' }));
};

export const filterColumnsByType = (columns: ColumnInfo[], allowedTypes: string[]): ColumnInfo[] => {
  if (!allowedTypes.length) return columns;
  const allowed = new Set(allowedTypes.map((t) => t.toLowerCase()));
  return columns.filter((column) => allowed.has(column.dataType.toLowerCase()));
};

export const getColumnNamesByType = (
  node: any,
  allowedTypes: string[],
  options: { fallbackToAll?: boolean } = {}
): string[] => {
  const infos = getColumnsWithTypesFromNode(node);
  const filtered = filterColumnsByType(infos, allowedTypes);
  if (filtered.length === 0 && options.fallbackToAll) {
    return infos.map((column) => column.name);
  }
  return filtered.map((column) => column.name);
};

export const mapColumnsToInfo = (node: any): ColumnInfo[] => getColumnsWithTypesFromNode(node);
