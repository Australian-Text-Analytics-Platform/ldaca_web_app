import { describe, expect, it } from 'vitest';
import {
  deriveNodeDisplayResults,
  deriveResultDisplayNodeIds,
  type NormalizedNodeResult,
} from '../tokenFrequencyAdapters';

/** Builds descending token-frequency rows for adapter boundary tests. */
const buildRows = (tokens: string[]) =>
  tokens.map((token, i) => ({ token, frequency: tokens.length - i }));

/** Wraps fixture rows in the normalized node shape consumed by display adapters. */
const makeNode = (rows: ReturnType<typeof buildRows>): NormalizedNodeResult => ({
  nodeId: 'n1',
  displayName: 'Node 1',
  rows,
  metadata: {},
});

describe('deriveResultDisplayNodeIds', () => {
  it('uses panel order for nodes that belong to the completed result', () => {
    expect(
      deriveResultDisplayNodeIds(['reference', 'study'], [
        { nodeId: 'study' },
        { nodeId: 'reference' },
      ]),
    ).toEqual(['study', 'reference']);
  });

  it('never introduces a live selection that is absent from the completed result', () => {
    expect(
      deriveResultDisplayNodeIds(['reference', 'study'], [{ nodeId: 'unrelated-node' }]),
    ).toEqual(['reference', 'study']);
  });

  it('appends result nodes that are absent from the current panel', () => {
    expect(deriveResultDisplayNodeIds(['reference', 'study'], [{ nodeId: 'study' }])).toEqual([
      'study',
      'reference',
    ]);
  });
});

describe('deriveNodeDisplayResults', () => {
  it('returns exactly N non-stop-word tokens when limit < available tokens', () => {
    const rawTokens = ['the', 'apple', 'and', 'banana', 'cherry', 'of', 'date', 'elderberry'];
    const node = makeNode(buildRows(rawTokens));
    const stopWords = new Set(['the', 'and', 'of']);

    const result = deriveNodeDisplayResults([node], stopWords, 3)[0]!;

    expect(result.displayRows).toHaveLength(3);
    expect(result.displayRows.map((r) => r.token)).toEqual(['apple', 'banana', 'cherry']);
  });

  it('filters stop words before truncating so cloud count matches the configured limit', () => {
    // 20 raw tokens: 10 are stop words interleaved with 10 content tokens
    const rawTokens: string[] = [];
    for (let i = 0; i < 10; i++) {
      rawTokens.push(`stop${String(i)}`);
      rawTokens.push(`content${String(i)}`);
    }
    const node = makeNode(buildRows(rawTokens));
    const stopWords = new Set(rawTokens.filter((t) => t.startsWith('stop')));

    const result = deriveNodeDisplayResults([node], stopWords, 5)[0]!;

    expect(result.displayRows).toHaveLength(5);
    expect(result.displayRows.every((r) => r.token.startsWith('content'))).toBe(true);
  });

  it('returns all non-stop-word tokens when limit exceeds available count', () => {
    const node = makeNode(buildRows(['a', 'the', 'b', 'c']));
    const stopWords = new Set(['the']);

    const result = deriveNodeDisplayResults([node], stopWords, 100)[0]!;

    expect(result.displayRows.map((r) => r.token)).toEqual(['a', 'b', 'c']);
  });

  it('returns all rows when no stop words and no limit', () => {
    const tokens = Array.from({ length: 50 }, (_, i) => `token${String(i)}`);
    const node = makeNode(buildRows(tokens));

    const result = deriveNodeDisplayResults([node], new Set(), null)[0]!;

    expect(result.displayRows).toHaveLength(50);
  });

  it('tracks filteredOutCount correctly', () => {
    const node = makeNode(buildRows(['the', 'a', 'hello', 'world']));
    const stopWords = new Set(['the', 'a']);

    const result = deriveNodeDisplayResults([node], stopWords, null)[0]!;

    expect(result.filteredOutCount).toBe(2);
    expect(result.filteredRows).toHaveLength(2);
    expect(result.displayRows).toHaveLength(2);
  });
});
