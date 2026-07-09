import { describe, expect, it } from 'vitest';
import type { WorkspaceNodeLike } from '../../nodeSelectionTypes';
import {
  type NodeInput,
  buildNodeMap,
  defaultColumnForNode,
  nodeInputsFromSelections,
  resolveNodeInputs,
  validateAdd,
} from '../nodeInputsCore';

const stringNode = (id: string, columns: string[], extra?: Partial<WorkspaceNodeLike>) =>
  ({ id, name: id, columns, ...extra }) as WorkspaceNodeLike;

const nodes: WorkspaceNodeLike[] = [
  stringNode('n1', ['text', 'id']),
  stringNode('n2', ['body'], { data: { document: 'body' } }),
  // numeric-only node: schema marks the column as integer
  {
    id: 'n3',
    name: 'n3',
    columns: ['count'],
    schema: [{ name: 'count', type: 'Int64' }],
  },
];

const map = buildNodeMap(nodes);

describe('nodeInputsFromSelections', () => {
  it('normalizes selection objects into persisted node inputs', () => {
    expect(
      nodeInputsFromSelections([
        { nodeId: 'n1', column: 'text' },
        { nodeId: '', column: 'ignored' },
        { nodeId: 'n2' },
      ]),
    ).toEqual([
      { node_id: 'n1', column: 'text' },
      { node_id: 'n2', column: null },
    ]);
  });
});

describe('validateAdd', () => {
  it('rejects unknown nodes', () => {
    expect(validateAdd('missing', [], map, {})).toMatch(/no longer/i);
  });

  it('rejects duplicates', () => {
    const current: NodeInput[] = [{ node_id: 'n1' }];
    expect(validateAdd('n1', current, map, {})).toMatch(/already/i);
  });

  it('enforces maxNodes', () => {
    const current: NodeInput[] = [{ node_id: 'n1' }];
    expect(validateAdd('n2', current, map, { maxNodes: 1 })).toMatch(/single node/i);
  });

  it('rejects when no compatible column for allowed types', () => {
    expect(validateAdd('n3', [], map, { allowedDataTypes: ['string'] })).toMatch(/compatible/i);
  });

  it('allows a valid string node', () => {
    expect(validateAdd('n1', [], map, { allowedDataTypes: ['string'] })).toBeNull();
  });

  it('accepts exactly two string columns when exactStringColumns is set', () => {
    expect(validateAdd('n1', [], map, { exactStringColumns: 2 })).toBeNull();
  });

  it('rejects nodes that do not have exactly two string columns', () => {
    const wide = buildNodeMap([stringNode('w', ['a', 'b', 'c'])]);
    expect(validateAdd('w', [], wide, { exactStringColumns: 2 })).toMatch(/exactly 2 string/i);
    expect(validateAdd('n3', [], map, { exactStringColumns: 2 })).toMatch(/exactly 2 string/i);
  });
});

describe('defaultColumnForNode', () => {
  it('prefers the document column when allowed', () => {
    expect(defaultColumnForNode(nodes[1]!, { allowedDataTypes: ['string'] })).toBe('body');
  });

  it('falls back to first allowed column when not document-only', () => {
    expect(defaultColumnForNode(nodes[0]!, { allowedDataTypes: ['string'] })).toBe('text');
  });

  it('returns empty when document-only and no document column', () => {
    expect(defaultColumnForNode(nodes[0]!, { docTypeOnly: true })).toBe('');
  });
});

describe('resolveNodeInputs', () => {
  it('drops stale ids and keeps valid stored columns', () => {
    const inputs: NodeInput[] = [
      { node_id: 'n1', column: 'id' },
      { node_id: 'gone', column: 'x' },
    ];
    const resolved = resolveNodeInputs(inputs, map, {});
    expect(resolved.map((r) => r.id)).toEqual(['n1']);
    expect(resolved[0]!.column).toBe('id');
  });

  it('re-defaults a column that is no longer valid', () => {
    const inputs: NodeInput[] = [{ node_id: 'n1', column: 'nope' }];
    const resolved = resolveNodeInputs(inputs, map, { allowedDataTypes: ['string'] });
    expect(resolved[0]!.column).toBe('text');
  });
});
