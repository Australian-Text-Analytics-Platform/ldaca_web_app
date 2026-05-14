import { describe, expect, it } from 'vitest';
import {
  computeTokensModelIntersection,
  type NodeColumnSelectionLike,
  type NodeLikeForIntersection,
} from '../tokensModelIntersection';

/** Build a node with a derived-tokens registry for a given source column. */
function makeNode(
  id: string,
  derived: Array<{ source_column: string; model: string }>,
): NodeLikeForIntersection {
  const registry: Record<string, unknown> = {};
  for (const [i, entry] of derived.entries()) {
    registry[`__derived__.tokens.${entry.source_column}.${entry.model}.${i}`] = {
      source_column: entry.source_column,
      form: 'tokens',
      model: entry.model,
    };
  }
  return { id, derived: registry };
}

function selection(nodeId: string, column: string): NodeColumnSelectionLike {
  return { nodeId, column };
}

describe('computeTokensModelIntersection', () => {
  it('returns [] when no selections are present', () => {
    expect(computeTokensModelIntersection([], [])).toEqual([]);
  });

  it('returns the single node’s models when only one node is selected', () => {
    const node = makeNode('n1', [
      { source_column: 'text', model: 'jieba' },
      { source_column: 'text', model: 'bert-base-uncased' },
    ]);
    expect(
      computeTokensModelIntersection([selection('n1', 'text')], [node]),
    ).toEqual(['jieba', 'bert-base-uncased']);
  });

  it('returns the intersection when two nodes share one model', () => {
    const a = makeNode('a', [
      { source_column: 'text', model: 'jieba' },
      { source_column: 'text', model: 'bert-base-uncased' },
    ]);
    const b = makeNode('b', [{ source_column: 'text', model: 'jieba' }]);
    expect(
      computeTokensModelIntersection(
        [selection('a', 'text'), selection('b', 'text')],
        [a, b],
      ),
    ).toEqual(['jieba']);
  });

  it('returns [] when ZH (jieba) and JA (lindera-ja-ipadic) are mixed', () => {
    // This is the exact Bug 1 scenario — pre-fix the picker locked to
    // jieba (from the first node) and materialize 400ed for the JA node.
    const zh = makeNode('zh', [{ source_column: 'text', model: 'jieba' }]);
    const ja = makeNode('ja', [
      { source_column: 'text', model: 'lindera-ja-ipadic' },
    ]);
    expect(
      computeTokensModelIntersection(
        [selection('zh', 'text'), selection('ja', 'text')],
        [zh, ja],
      ),
    ).toEqual([]);
  });

  it('returns [] when one of the nodes lacks a tokens column for the selected source', () => {
    const a = makeNode('a', [{ source_column: 'text', model: 'jieba' }]);
    const b = makeNode('b', []);
    expect(
      computeTokensModelIntersection(
        [selection('a', 'text'), selection('b', 'text')],
        [a, b],
      ),
    ).toEqual([]);
  });

  it('returns [] when a selection has no column set', () => {
    const node = makeNode('n1', [{ source_column: 'text', model: 'jieba' }]);
    expect(
      computeTokensModelIntersection(
        [{ nodeId: 'n1', column: null }],
        [node],
      ),
    ).toEqual([]);
  });

  it('ignores derived entries whose source_column does not match the selection', () => {
    const node = makeNode('n1', [
      { source_column: 'text', model: 'jieba' },
      { source_column: 'body', model: 'lindera-ja-ipadic' },
    ]);
    expect(
      computeTokensModelIntersection([selection('n1', 'text')], [node]),
    ).toEqual(['jieba']);
  });

  it('honours per-node source columns when they differ between nodes', () => {
    // Per-node, each selection points at a different column. The
    // intersection then runs across each node's models for ITS column —
    // not a shared column.
    const a = makeNode('a', [
      { source_column: 'text', model: 'jieba' },
      { source_column: 'text', model: 'bert-base-uncased' },
    ]);
    const b = makeNode('b', [
      { source_column: 'body', model: 'bert-base-uncased' },
    ]);
    expect(
      computeTokensModelIntersection(
        [selection('a', 'text'), selection('b', 'body')],
        [a, b],
      ),
    ).toEqual(['bert-base-uncased']);
  });

  it('preserves the first node’s model order in the result', () => {
    const a = makeNode('a', [
      { source_column: 'text', model: 'zeta' },
      { source_column: 'text', model: 'alpha' },
      { source_command: 'irrelevant', model: 'ignore' } as unknown as {
        source_column: string;
        model: string;
      },
      { source_column: 'text', model: 'beta' },
    ]);
    const b = makeNode('b', [
      { source_column: 'text', model: 'alpha' },
      { source_column: 'text', model: 'beta' },
      { source_column: 'text', model: 'zeta' },
    ]);
    expect(
      computeTokensModelIntersection(
        [selection('a', 'text'), selection('b', 'text')],
        [a, b],
      ),
    ).toEqual(['zeta', 'alpha', 'beta']);
  });
});
