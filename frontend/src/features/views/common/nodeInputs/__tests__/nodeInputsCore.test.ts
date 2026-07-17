import { describe, expect, it } from 'vitest';
import { Field, Int64, Utf8 } from 'apache-arrow';
import {
  projectWorkspaceNodeMetadata,
  type WorkspaceNodeMetadata,
} from '@/features/workspace/common/workspaceNodeMetadata';
import {
  type NodeInput,
  buildNodeMap,
  defaultColumnForNode,
  nodeInputsFromSelections,
  resolveNodeInputs,
  validateAdd,
} from '../nodeInputsCore';

const stringNode = (id: string, extra?: Partial<WorkspaceNodeMetadata>): WorkspaceNodeMetadata => ({
  ...projectWorkspaceNodeMetadata({ id, name: id }),
  ...extra,
});

const nodes: WorkspaceNodeMetadata[] = [
  stringNode('n1'),
  stringNode('n2', { document: 'body' }),
  stringNode('n3'),
];

const columnInfos = (node: WorkspaceNodeMetadata) => {
  const names = node.id === 'n1' ? ['text', 'id'] : node.id === 'n2' ? ['body'] : ['count'];
  return names.map((name) => ({
    name,
    dataType: node.id === 'n3' ? ('integer' as const) : ('string' as const),
    field: new Field(name, node.id === 'n3' ? new Int64() : new Utf8()),
  }));
};

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

  it('allows nodes without matching columns so the picker can stay empty', () => {
    expect(validateAdd('n3', [], map, { allowedDataTypes: ['string'] })).toBeNull();
  });

  it('allows a valid string node', () => {
    expect(validateAdd('n1', [], map, { allowedDataTypes: ['string'] })).toBeNull();
  });
});

describe('defaultColumnForNode', () => {
  it('prefers the document column when allowed', () => {
    expect(defaultColumnForNode(nodes[1]!, { allowedDataTypes: ['string'] }, columnInfos)).toBe(
      'body',
    );
  });

  it('falls back to first allowed column when not document-only', () => {
    expect(defaultColumnForNode(nodes[0]!, { allowedDataTypes: ['string'] }, columnInfos)).toBe(
      'text',
    );
  });

  it('leaves the column empty when no allowed column exists', () => {
    expect(defaultColumnForNode(nodes[2]!, { allowedDataTypes: ['string'] }, columnInfos)).toBe('');
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
    const resolved = resolveNodeInputs(inputs, map, {}, columnInfos);
    expect(resolved.map((r) => r.id)).toEqual(['n1']);
    expect(resolved[0]!.column).toBe('id');
  });

  it('re-defaults a column that is no longer valid', () => {
    const inputs: NodeInput[] = [{ node_id: 'n1', column: 'nope' }];
    const resolved = resolveNodeInputs(inputs, map, { allowedDataTypes: ['string'] }, columnInfos);
    expect(resolved[0]!.column).toBe('text');
  });

  it('resolves an added node with empty options when no allowed column exists', () => {
    const inputs: NodeInput[] = [{ node_id: 'n3', column: null }];
    const resolved = resolveNodeInputs(inputs, map, { allowedDataTypes: ['string'] }, columnInfos);

    expect(resolved[0]!.column).toBe('');
    expect(resolved[0]!.columnOptions).toEqual([]);
  });
});
