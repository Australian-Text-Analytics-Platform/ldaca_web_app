import { describe, expect, it } from 'vitest';
import { deriveTokenizerModelsByNode } from '../tokenizerModelPreferences';

describe('deriveTokenizerModelsByNode', () => {
  it('combines persisted node models with live overrides for selected columns', () => {
    const selections = [
      { nodeId: 'node-a', column: 'text' },
      { nodeId: 'node-b', column: 'body' },
      { nodeId: 'node-c', column: '' },
    ];
    const nodeInfoCache = {
      'node-a': { id: 'node-a', name: 'Node A', tokenizer_models: { text: 'stored-a' } },
      'node-b': { id: 'node-b', name: 'Node B', tokenizer_models: { body: 'stored-b' } },
      'node-c': { id: 'node-c', name: 'Node C', tokenizer_models: { text: 'ignored' } },
    };

    expect(deriveTokenizerModelsByNode(selections, nodeInfoCache, { 'node-b': 'live-b' })).toEqual({
      'node-a': 'stored-a',
      'node-b': 'live-b',
    });
  });
});
