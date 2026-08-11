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

/** Every concrete Arrow type supplies its native schema spelling via `toString`. */
export type ArrowDataType = DataType<Type, TypeMap> & { toString(): string };
export type ArrowField = Field<ArrowDataType>;

export interface ArrowColumn {
  name: string;
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
  totalRows: number | null;
  etag: string | null;
}

const isArrowStringType = (type: ArrowDataType): boolean =>
  DataType.isUtf8(type) || DataType.isLargeUtf8(type) || DataType.isUtf8View(type);

const arrowListChild = (type: ArrowDataType): ArrowField | undefined => {
  if (!DataType.isList(type) && !DataType.isLargeList(type) && !DataType.isFixedSizeList(type)) {
    return undefined;
  }
  return type.children[0];
};

/** Returns the exact extension identity carried by the IPC field metadata. */
export const arrowExtensionName = (field: ArrowField): string | null =>
  field.metadata.get(ARROW_EXTENSION_NAME) ?? null;

/**
 * Names a decoded field without translating it into a Wordflow-specific type.
 * Used by schema controls and diagnostics: semantic extensions retain the
 * exact identity published in IPC metadata; ordinary fields use Apache
 * Arrow's own native type spelling.
 */
export const arrowTypeName = (field: ArrowField): string =>
  arrowExtensionName(field) ?? field.type.toString();

/** Native Arrow predicates used by feature-specific behavior at its call site. */
export const isArrowStringField = (field: ArrowField): boolean => isArrowStringType(field.type);

export const isArrowStringListField = (field: ArrowField): boolean => {
  const child = arrowListChild(field.type);
  return child !== undefined && isArrowStringType(child.type);
};

export const isArrowDictionaryField = (field: ArrowField): boolean =>
  DataType.isDictionary(field.type);

export const isArrowIntegerField = (field: ArrowField): boolean => DataType.isInt(field.type);

export const isArrowFloatField = (field: ArrowField): boolean =>
  DataType.isFloat(field.type) || DataType.isDecimal(field.type);

export const isArrowBooleanField = (field: ArrowField): boolean => DataType.isBool(field.type);

export const isArrowTemporalField = (field: ArrowField): boolean =>
  DataType.isDate(field.type) ||
  DataType.isTime(field.type) ||
  DataType.isTimestamp(field.type) ||
  DataType.isDuration(field.type) ||
  DataType.isInterval(field.type);

const normalizeArrowValue = (value: unknown, type?: ArrowDataType): unknown => {
  if (type && DataType.isTimestamp(type) && typeof value === 'number') {
    return new Date(value).toISOString();
  }
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((child) => normalizeArrowValue(child));
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
      field: field as ArrowField,
    }));
    const columns = schema.map((column) => column.name);
    const rows = table.toArray().map((row) => {
      const normalized = normalizeArrowValue(row);
      if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) return {};
      const record = normalized as Record<string, unknown>;
      return Object.fromEntries(
        schema.map((column) => [
          column.name,
          normalizeArrowValue(record[column.name], column.field.type),
        ]),
      );
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
  totalRows: (() => {
    const raw = response.headers.get('X-Wordflow-Total-Rows');
    if (raw === null) return null;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  })(),
  etag: response.headers.get('ETag'),
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

export interface ArrowPageRequest {
  page: number;
  pageSize: number;
  sortBy: string | null;
  descending: boolean;
}

/** Fetches one immutable paged Arrow Result table projection. */
export const fetchArrowTablePage = async (
  url: string,
  request: ArrowPageRequest,
): Promise<ArrowTablePage> => {
  const requestUrl = new URL(url, `${getApiBase()}/`);
  requestUrl.searchParams.set('page', String(request.page));
  requestUrl.searchParams.set('page_size', String(request.pageSize));
  if (request.sortBy) requestUrl.searchParams.set('sort_by', request.sortBy);
  requestUrl.searchParams.set('descending', String(request.descending));
  const response = await fetch(requestUrl, { credentials: 'include' });
  if (!response.ok) {
    throw new Error(`Arrow table page request failed (${String(response.status)})`);
  }
  const contentType = response.headers.get('Content-Type')?.split(';', 1)[0];
  if (contentType !== ARROW_STREAM_MEDIA_TYPE) {
    throw new Error(
      `Expected ${ARROW_STREAM_MEDIA_TYPE}, received ${contentType ?? 'no content type'}`,
    );
  }
  return decodeArrowPage(await response.arrayBuffer(), response);
};
