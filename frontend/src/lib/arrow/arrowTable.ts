import {
  DataType,
  tableFromIPC,
  type Field,
  type Table,
  type Type,
  type TypeMap,
} from 'apache-arrow';
import { getApiBase } from '@/lib/backend/env';

const ARROW_STREAM_MEDIA_TYPE = 'application/vnd.apache.arrow.stream';
const ARROW_EXTENSION_NAME = 'ARROW:extension:name';

export const TOPIC_DISTRIBUTION_EXTENSION = 'org.ldaca.wordflow.topic_distribution.v1';

type ArrowDataType = DataType<Type, TypeMap>;
export type ArrowField = Field<ArrowDataType>;

/** Product-facing column categories derived from Arrow fields, never wire-format strings. */
export type ColumnKind =
  | 'string'
  | 'string-list'
  | 'topic-distribution'
  | 'datetime'
  | 'boolean'
  | 'integer'
  | 'float'
  | 'categorical'
  | 'structured'
  | 'unknown';

export interface ArrowColumn {
  name: string;
  kind: ColumnKind;
  field: ArrowField;
}

export interface ArrowTableData {
  table: Table<TypeMap>;
  columns: string[];
  schema: ArrowColumn[];
  rows: Record<string, unknown>[];
}

export interface ArrowTablePage extends ArrowTableData {
  hasNext: boolean;
}

const isStringType = (type: ArrowDataType): boolean =>
  DataType.isUtf8(type) || DataType.isLargeUtf8(type) || DataType.isUtf8View(type);

const listChild = (type: ArrowDataType): ArrowField | undefined => {
  if (!DataType.isList(type) && !DataType.isLargeList(type) && !DataType.isFixedSizeList(type)) {
    return undefined;
  }
  return type.children[0];
};

/** Classify one decoded Arrow field for UI behavior without parsing dtype spellings. */
export const columnKind = (field: ArrowField): ColumnKind => {
  if (field.metadata.get(ARROW_EXTENSION_NAME) === TOPIC_DISTRIBUTION_EXTENSION) {
    return 'topic-distribution';
  }

  const type = field.type;
  if (DataType.isDictionary(type)) return 'categorical';
  if (isStringType(type)) return 'string';
  if (DataType.isInt(type)) return 'integer';
  if (DataType.isFloat(type) || DataType.isDecimal(type)) return 'float';
  if (DataType.isBool(type)) return 'boolean';
  if (
    DataType.isDate(type) ||
    DataType.isTime(type) ||
    DataType.isTimestamp(type) ||
    DataType.isDuration(type) ||
    DataType.isInterval(type)
  ) {
    return 'datetime';
  }

  const child = listChild(type);
  if (child) return isStringType(child.type) ? 'string-list' : 'unknown';
  if (DataType.isStruct(type) || DataType.isMap(type) || DataType.isUnion(type)) {
    return 'structured';
  }
  return 'unknown';
};

const normalizeArrowValue = (value: unknown): unknown => {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeArrowValue);
  if (value && typeof value === 'object' && 'toJSON' in value) {
    const toJSON = (value as { toJSON?: unknown }).toJSON;
    if (typeof toJSON === 'function') {
      return normalizeArrowValue((toJSON as () => unknown).call(value));
    }
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, normalizeArrowValue(child)]),
    );
  }
  return value;
};

export const decodeArrowTable = async (source: Blob | ArrayBuffer): Promise<ArrowTableData> => {
  try {
    const buffer = source instanceof Blob ? await source.arrayBuffer() : source;
    const table = tableFromIPC<TypeMap>(buffer);
    const schema = table.schema.fields.map((field) => ({
      name: field.name,
      kind: columnKind(field as ArrowField),
      field: field as ArrowField,
    }));
    const columns = schema.map((column) => column.name);
    const rows = table.toArray().map((row) => {
      const normalized = normalizeArrowValue(row);
      return normalized && typeof normalized === 'object' && !Array.isArray(normalized)
        ? (normalized as Record<string, unknown>)
        : {};
    });
    return { table, columns, schema, rows };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Arrow table decode failed: ${message}`, { cause: error });
  }
};

export const decodeArrowPage = async (
  source: Blob | ArrayBuffer,
  response: Response,
): Promise<ArrowTablePage> => ({
  ...(await decodeArrowTable(source)),
  hasNext: response.headers.get('X-Wordflow-Has-Next') === 'true',
});

export const fetchArrowTable = async (url: string): Promise<ArrowTableData> => {
  const requestUrl = new URL(url, `${getApiBase()}/`).toString();
  const response = await fetch(requestUrl, { credentials: 'include' });
  if (!response.ok) {
    throw new Error(`Arrow table request failed (${String(response.status)})`);
  }
  const contentType = response.headers.get('Content-Type')?.split(';', 1)[0];
  if (contentType !== ARROW_STREAM_MEDIA_TYPE) {
    throw new Error(
      `Expected ${ARROW_STREAM_MEDIA_TYPE}, received ${contentType ?? 'no content type'}`,
    );
  }
  return decodeArrowTable(await response.arrayBuffer());
};
