import {
  Dictionary,
  Field,
  FixedSizeList,
  Float64,
  Int32,
  Int64,
  LargeList,
  Schema,
  Struct,
  Table,
  TimestampMicrosecond,
  TimestampNanosecond,
  Uint32,
  Utf8,
  Utf8View,
  tableFromArrays,
  tableToIPC,
  vectorFromArray,
} from 'apache-arrow';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  arrowExtensionName,
  arrowTypeDisplayName,
  arrowTypeName,
  decodeArrowPage,
  decodeArrowTable,
  fetchArrowTable,
} from '../arrowTable';
import { isTopicCoverageField, TOPIC_COVERAGE_EXTENSION } from '../semanticTypes';

const stream = (table: ReturnType<typeof tableFromArrays>): Uint8Array =>
  tableToIPC(table, 'stream');

afterEach(() => {
  vi.restoreAllMocks();
  delete window.__BACKEND_URL__;
});

describe('Arrow table transport', () => {
  it('uses friendly labels only for the five canonical physical types', () => {
    const fields = [
      new Field('text', new Utf8View()),
      new Field('category', new Dictionary(new Utf8View(), new Uint32())),
      new Field('count', new Int64()),
      new Field('score', new Float64()),
      new Field('created_at', new TimestampMicrosecond('UTC')),
    ];

    expect(fields.map((field) => arrowTypeDisplayName(field))).toEqual([
      'string',
      'categorical',
      'integer',
      'float',
      'datetime',
    ]);
    expect(fields.map((field) => arrowTypeName(field))).toEqual([
      'Utf8View',
      'Dictionary<Uint32, Utf8View>',
      'Int64',
      'Float64',
      'Timestamp<MICROSECOND, UTC>',
    ]);
  });

  it('keeps alternate, nested, and extension type names unchanged', () => {
    const fields = [
      new Field('alternate_text', new Utf8()),
      new Field('alternate_category', new Dictionary(new Utf8View(), new Int32())),
      new Field('alternate_timestamp', new TimestampNanosecond('UTC')),
      new Field('words', new LargeList(new Field('item', new Utf8View()))),
      new Field('extension', new Int64(), true, new Map([['ARROW:extension:name', 'Int64']])),
    ];

    expect(fields.map((field) => arrowTypeDisplayName(field))).toEqual([
      'Utf8',
      'Dictionary<Int32, Utf8View>',
      'Timestamp<NANOSECOND, UTC>',
      'LargeList<Utf8View>',
      'Int64',
    ]);
  });

  it('decodes one self-contained IPC stream into UI rows and schema metadata', async () => {
    const source = new Table({
      token: vectorFromArray(['one', 'two'], new Utf8()),
      count: vectorFromArray([1n, 2n], new Int64()),
    });

    const decoded = await decodeArrowTable(stream(source).buffer as ArrayBuffer);

    expect(
      decoded.schema.map(({ name, field }) => ({ name, typeName: arrowTypeName(field) })),
    ).toEqual([
      { name: 'token', typeName: 'Utf8' },
      { name: 'count', typeName: 'Int64' },
    ]);
    expect(decoded.rows).toEqual([
      { token: 'one', count: '1' },
      { token: 'two', count: '2' },
    ]);
  });

  it('decodes timestamp values into UTC ISO strings', async () => {
    const source = new Table({
      created_at: vectorFromArray(
        [new Date('2020-10-16T15:20:22.000Z')],
        new TimestampMicrosecond('UTC'),
      ),
    });

    const decoded = await decodeArrowTable(stream(source).buffer as ArrayBuffer);

    expect(decoded.schema[0] && arrowTypeName(decoded.schema[0].field)).toBe(
      'Timestamp<MICROSECOND, UTC>',
    );
    expect(decoded.rows).toEqual([{ created_at: '2020-10-16T15:20:22.000Z' }]);
  });

  it('retains Utf8View and LargeList<Utf8View> native Arrow type names', async () => {
    const strings = vectorFromArray(['one', 'two'], new Utf8View());
    const stringListType = new LargeList(new Field('item', new Utf8View(), true));
    const stringLists = vectorFromArray([['one', 'two'], ['three']], stringListType);
    const source = new Table({ strings, stringLists });

    const decoded = await decodeArrowTable(stream(source).buffer as ArrayBuffer);

    expect(
      decoded.schema.map(({ name, field }) => ({ name, typeName: arrowTypeName(field) })),
    ).toEqual([
      { name: 'strings', typeName: 'Utf8View' },
      { name: 'stringLists', typeName: 'LargeList<Utf8View>' },
    ]);
    expect(decoded.rows).toEqual([
      { strings: 'one', stringLists: ['one', 'two'] },
      { strings: 'two', stringLists: ['three'] },
    ]);
  });

  it('recognizes semantic extension metadata without inspecting nested field names', () => {
    const entry = new Field(
      'item',
      new Struct([new Field('topic_id', new Int64()), new Field('coverage', new Float64())]),
    );
    const coverage = new Field(
      'coverage',
      new FixedSizeList(3, entry),
      true,
      new Map([['ARROW:extension:name', TOPIC_COVERAGE_EXTENSION]]),
    );

    expect(arrowTypeName(coverage)).toBe(TOPIC_COVERAGE_EXTENSION);
    expect(isTopicCoverageField(coverage)).toBe(true);
  });

  it('preserves the exact identity of an unknown foreign extension', () => {
    const foreign = new Field(
      'measurement',
      new Struct([new Field('value', new Int64())]),
      true,
      new Map([
        ['ARROW:extension:name', 'org.example.foreign_measure.v2'],
        ['ARROW:extension:metadata', '{"unit":"widgets"}'],
      ]),
    );

    expect(arrowExtensionName(foreign)).toBe('org.example.foreign_measure.v2');
    expect(arrowTypeName(foreign)).toBe('org.example.foreign_measure.v2');
    expect(foreign.metadata.get('ARROW:extension:metadata')).toBe('{"unit":"widgets"}');
  });

  it('decodes fixed-size Topic Coverage values through official Apache Arrow', async () => {
    const entry = new Field(
      'item',
      new Struct([new Field('topic_id', new Int64()), new Field('coverage', new Float64())]),
    );
    const type = new FixedSizeList(2, entry);
    const field = new Field(
      'coverage',
      type,
      true,
      new Map([['ARROW:extension:name', TOPIC_COVERAGE_EXTENSION]]),
    );
    const values = vectorFromArray(
      [
        [
          { topic_id: -1n, coverage: 0.2 },
          { topic_id: 0n, coverage: 0.8 },
        ],
      ],
      type,
    );
    const source = new Table(new Schema([field]), { coverage: values });

    const decoded = await decodeArrowTable(stream(source).buffer as ArrayBuffer);

    expect(decoded.schema[0] && arrowTypeName(decoded.schema[0].field)).toBe(
      TOPIC_COVERAGE_EXTENSION,
    );
    expect(decoded.rows).toEqual([
      {
        coverage: [
          { topic_id: '-1', coverage: 0.2 },
          { topic_id: '0', coverage: 0.8 },
        ],
      },
    ]);
  });

  it('reads page continuation only from the transport header', async () => {
    const source = tableFromArrays({ value: ['only'] });
    const response = new Response(null, {
      headers: { 'X-Wordflow-Has-Next': 'true', ETag: '"revision-1"' },
    });

    const decoded = await decodeArrowPage(stream(source).buffer as ArrayBuffer, response);

    expect(decoded.rows).toEqual([{ value: 'only' }]);
    expect(decoded.hasNext).toBe(true);
    expect(decoded.etag).toBe('"revision-1"');
  });

  it('resolves semantic table URLs against the runtime backend origin', async () => {
    window.__BACKEND_URL__ = 'http://127.0.0.1:49152';
    const source = tableFromArrays({ value: ['one'] });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(stream(source), {
        headers: { 'Content-Type': 'application/vnd.apache.arrow.stream' },
      }),
    );

    await fetchArrowTable('/api/workspaces/workspace-1/analyses/analysis-1/result/tables/main');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:49152/api/workspaces/workspace-1/analyses/analysis-1/result/tables/main',
      { credentials: 'include' },
    );
  });

  it('adds table context to decoder errors and preserves the Arrow cause', async () => {
    const validStream = stream(tableFromArrays({ value: ['one'] }));
    const truncatedStream = validStream.slice(0, 16).buffer as ArrayBuffer;

    try {
      await decodeArrowTable(truncatedStream);
      expect.fail('Expected invalid Arrow IPC to be rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/^Arrow table decode failed: /);
      expect((error as Error).cause).toBeDefined();
    }
  });
});
