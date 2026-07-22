import { describe, expect, it } from 'vitest';
import { deriveTokenizerModelsByNode } from '../tokenizerModelPreferences';

describe('deriveTokenizerModelsByNode', () => {
  it('combines node-level preferences with live overrides independently of columns', () => {
    const selections = [
      { nodeId: 'node-a', column: 'text' },
      { nodeId: 'node-b', column: 'body' },
      { nodeId: 'node-c', column: '' },
    ];
    const nodeInfoCache = {
      'node-a': { id: 'node-a', name: 'Node A', tokenizer_model: 'stored-a' },
      'node-b': { id: 'node-b', name: 'Node B', tokenizer_model: 'stored-b' },
      'node-c': { id: 'node-c', name: 'Node C', tokenizer_model: 'stored-c' },
    };

    expect(deriveTokenizerModelsByNode(selections, nodeInfoCache, { 'node-b': 'live-b' })).toEqual({
      'node-a': 'stored-a',
      'node-b': 'live-b',
      'node-c': 'stored-c',
    });
  });

  it('keeps an explicit empty live override instead of falling back to storage', () => {
    expect(
      deriveTokenizerModelsByNode(
        [{ nodeId: 'node-a', column: 'text' }],
        {
          'node-a': { id: 'node-a', name: 'Node A', tokenizer_model: 'stored-a' },
        },
        { 'node-a': '' },
      ),
    ).toEqual({ 'node-a': '' });
  });
});
