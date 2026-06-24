import { describe, expect, it } from 'vitest';
import type { WorkspaceNodeLike } from '../nodeSelectionTypes';
import { deriveTokenizerModelsByNode } from '../tokenizerModelPreferences';

describe('deriveTokenizerModelsByNode', () => {
  it('combines persisted node models with live overrides for selected columns', () => {
    const selections = [
      { nodeId: 'node-a', column: 'text' },
      { nodeId: 'node-b', column: 'body' },
      { nodeId: 'node-c', column: '' },
    ];
    const nodes: WorkspaceNodeLike[] = [
      { id: 'node-a', tokenizer_models: { text: 'stored-a' } },
      { node_id: 'node-b', tokenizer_models: { body: 'stored-b' } },
      { id: 'node-c', tokenizer_models: { text: 'ignored' } },
    ];

    expect(deriveTokenizerModelsByNode(selections, nodes, { 'node-b': 'live-b' })).toEqual({
      'node-a': 'stored-a',
      'node-b': 'live-b',
    });
  });
});
