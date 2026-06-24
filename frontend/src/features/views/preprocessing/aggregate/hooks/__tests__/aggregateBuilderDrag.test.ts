import { describe, expect, it, vi } from 'vitest';

import type { AggregateBuilderToken } from '../aggregateExpressionModel';
import {
  getAggregateDropInsertIndex,
  readAggregateDragPayload,
  writeAggregateDragPayload,
  type AggregateBuilderDragPayload,
} from '../useAggregateBuilderDrag';

const makeReader = (entries: Record<string, string>): Pick<DataTransfer, 'getData'> => ({
  getData: (type: string) => entries[type] ?? '',
});

const token = (id: string): AggregateBuilderToken => ({ id, kind: 'custom', value: id });

describe('aggregateBuilderDrag payload helpers', () => {
  it('reads the custom MIME payload before generic JSON and plain text', () => {
    const customPayload: AggregateBuilderDragPayload = {
      source: 'palette',
      kind: 'column',
      column: 'speaker',
      dtype: 'str',
    };
    const jsonPayload: AggregateBuilderDragPayload = { source: 'existing', id: 'token-2' };

    const reader = makeReader({
      'application/x-ldaca-builder-token': JSON.stringify(customPayload),
      'application/json': JSON.stringify(jsonPayload),
      'text/plain': 'speaker',
    });

    expect(readAggregateDragPayload(reader, null)).toEqual(customPayload);
  });

  it('falls back to the cached payload when browser drag metadata is unavailable', () => {
    const fallback: AggregateBuilderDragPayload = { source: 'palette', kind: 'custom' };

    expect(readAggregateDragPayload(makeReader({}), fallback)).toEqual(fallback);
    expect(readAggregateDragPayload(null, fallback)).toEqual(fallback);
  });

  it('rejects malformed JSON drag payloads instead of treating them as tokens', () => {
    const fallback: AggregateBuilderDragPayload = { source: 'existing', id: 'safe-token' };

    const reader = makeReader({
      'application/x-ldaca-builder-token': '{"source":"palette","kind":"column"}',
      'application/json': 'not-json',
      'text/plain': JSON.stringify({ source: 'unknown', id: 'bad' }),
    });

    expect(readAggregateDragPayload(reader, fallback)).toEqual(fallback);
  });

  it('writes structured payloads to custom and JSON slots and display text to plain text', () => {
    const setData = vi.fn();
    const payload: AggregateBuilderDragPayload = { source: 'existing', id: 'token-1' };

    writeAggregateDragPayload({ setData }, payload, 'Column token');

    expect(setData).toHaveBeenCalledWith(
      'application/x-ldaca-builder-token',
      JSON.stringify(payload),
    );
    expect(setData).toHaveBeenCalledWith('application/json', JSON.stringify(payload));
    expect(setData).toHaveBeenCalledWith('text/plain', 'Column token');
  });
});

describe('getAggregateDropInsertIndex', () => {
  it('appends when there is no drop indicator or the target token is stale', () => {
    const tokens = [token('a'), token('b')];

    expect(getAggregateDropInsertIndex(tokens, null)).toBe(2);
    expect(getAggregateDropInsertIndex(tokens, { tokenId: 'missing', position: 'before' })).toBe(2);
  });

  it('converts before and after indicators into token insertion slots', () => {
    const tokens = [token('a'), token('b'), token('c')];

    expect(getAggregateDropInsertIndex(tokens, { tokenId: 'b', position: 'before' })).toBe(1);
    expect(getAggregateDropInsertIndex(tokens, { tokenId: 'b', position: 'after' })).toBe(2);
  });
});
